"""HTTP endpoints for calendar feeds and the private CalDAV server.

These are plain Django views (not DRF): calendar clients authenticate purely by
the non-guessable secret embedded in the URL, so there is no session/CSRF.
"""

import re
from xml.sax.saxutils import escape as xml_escape

from django.db import IntegrityError
from django.http import (
    Http404,
    HttpResponse,
    HttpResponseBadRequest,
    HttpResponseForbidden,
    HttpResponseNotAllowed,
)
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt

from bubble.bookings.models import Booking, BookingStatus, Message

from . import feeds
from .ical import VEvent, build_calendar, parse_calendar
from .models import CalDAVObject, CalendarLink, CalendarLinkKind

CALDAV_NS = "urn:ietf:params:xml:ns:caldav"
DAV_NS = "DAV:"

ICS_CONTENT_TYPE = "text/calendar; charset=utf-8"


# ---------------------------------------------------------------------------
# Public read-only iCalendar feeds
# ---------------------------------------------------------------------------


def _ics_response(name: str, events: list[VEvent]) -> HttpResponse:
    body = build_calendar(name, events)
    resp = HttpResponse(body, content_type=ICS_CONTENT_TYPE)
    resp["Content-Disposition"] = 'inline; filename="calendar.ics"'
    return resp


def item_feed(request, secret: str):
    """Public read-only feed for a single bookable item."""
    link = get_object_or_404(
        CalendarLink.objects.select_related("item", "item__user"),
        secret=secret,
        kind=CalendarLinkKind.ITEM,
    )
    item = link.item
    if item is None or not feeds.is_bookable(item):
        raise Http404
    link.touch()

    bookings = feeds.feed_bookings_for_item(item)
    # Per-item feed: the calendar itself is named after the item, so events do
    # not repeat the booker's identity (privacy).
    events = feeds.bookings_to_events(
        bookings, summary_field="item", include_booker=False
    )
    return _ics_response(item.name or "Item", events)


def collection_feed(request, secret: str):
    """Public read-only feed for a collection of bookable items.

    Each event's title is the booked item's name and the description carries the
    name of the person who booked it.
    """
    link = get_object_or_404(
        CalendarLink.objects.select_related("collection"),
        secret=secret,
        kind=CalendarLinkKind.COLLECTION,
    )
    collection = link.collection
    if collection is None:
        raise Http404
    link.touch()

    bookable_items = collection.items.filter(sales_type__in=feeds.BOOKABLE_SALES_TYPES)
    bookings = (
        Booking.objects.filter(
            item__in=bookable_items, status__in=feeds.FEED_BOOKING_STATUSES
        )
        .select_related("item", "user", "remote_booker_actor")
        .order_by("time_from")
    )
    events = feeds.bookings_to_events(
        bookings, summary_field="item", include_booker=True
    )
    return _ics_response(collection.name, events)


# ---------------------------------------------------------------------------
# Private read-write CalDAV endpoint
# ---------------------------------------------------------------------------


def _etag(booking: Booking) -> str:
    stamp = booking.updated_at or booking.created_at
    return f'"{int(stamp.timestamp())}-{booking.id}"'


@method_decorator(csrf_exempt, name="dispatch")
class CalDAVView(View):
    """Handles the per-user CalDAV collection hierarchy.

    Resource levels (by URL):
      * home     — ``/caldav/dav/<secret>/``
      * calendar — ``/caldav/dav/<secret>/<item_id>/``       (one per item)
      * event    — ``/caldav/dav/<secret>/<item_id>/<name>`` (one per booking)
    """

    http_method_names = [
        "get",
        "put",
        "delete",
        "options",
        "propfind",
        "report",
        "head",
    ]

    # -- request plumbing ---------------------------------------------------

    def setup(self, request, *args, **kwargs):
        super().setup(request, *args, **kwargs)
        self.secret = kwargs.get("secret")
        self.item_id = kwargs.get("item_id")
        self.resource = kwargs.get("resource")
        self.link = None
        self.item = None

    def dispatch(self, request, *args, **kwargs):
        self.link = (
            CalendarLink.objects.filter(secret=self.secret, kind=CalendarLinkKind.USER)
            .select_related("user")
            .first()
        )
        if self.link is None:
            raise Http404
        self.user = self.link.user

        if self.item_id is not None:
            self.item = self._get_item(self.item_id)
            if self.item is None:
                raise Http404
        return super().dispatch(request, *args, **kwargs)

    def _get_item(self, item_id):
        return self._bookable_items().filter(pk=item_id).first()

    def _bookable_items(self):
        return feeds.bookable_items_for_user(self.user)

    @property
    def level(self) -> str:
        if self.item_id is None:
            return "home"
        if not self.resource:
            return "calendar"
        return "event"

    # -- URL helpers --------------------------------------------------------

    def _home_path(self) -> str:
        return reverse("caldav:dav-home", kwargs={"secret": self.secret})

    def _calendar_path(self, item_id) -> str:
        return reverse(
            "caldav:dav-calendar",
            kwargs={"secret": self.secret, "item_id": item_id},
        )

    def _event_path(self, item_id, resource: str) -> str:
        return reverse(
            "caldav:dav-event",
            kwargs={
                "secret": self.secret,
                "item_id": item_id,
                "resource": resource,
            },
        )

    def _resource_name_for(self, booking: Booking) -> str:
        obj = getattr(booking, "caldav_object", None)
        if obj is not None:
            return obj.resource_name
        return f"booking-{booking.id}.ics"

    # -- OPTIONS ------------------------------------------------------------

    def options(self, request, *args, **kwargs):
        resp = HttpResponse(status=200)
        resp["DAV"] = "1, 2, 3, calendar-access"
        resp["Allow"] = "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, REPORT"
        resp["Content-Length"] = "0"
        return resp

    # -- GET ----------------------------------------------------------------

    def get(self, request, *args, **kwargs):
        if self.level != "event":
            # A GET on a collection returns the whole calendar (handy for
            # debugging / simple subscription clients).
            if self.level == "calendar":
                bookings = feeds.feed_bookings_for_item(self.item)
                events = feeds.bookings_to_events(
                    bookings, summary_field="item", include_booker=True
                )
                return _ics_response(self.item.name or "Item", events)
            return HttpResponseNotAllowed(["PROPFIND"])

        booking = self._resolve_booking(self.resource)
        if booking is None:
            raise Http404
        events = feeds.bookings_to_events(
            [booking], summary_field="item", include_booker=True
        )
        resp = _ics_response(self.item.name or "Item", events)
        resp["ETag"] = _etag(booking)
        return resp

    head = get

    def _resolve_booking(self, resource: str) -> Booking | None:
        """Resolve an event resource name to a booking of the current item."""
        name = resource
        obj = CalDAVObject.objects.filter(
            link=self.link, item=self.item, resource_name=name
        ).first()
        if obj is not None:
            return obj.booking
        # Fall back to the synthetic name we expose for app-created bookings.
        if name.startswith("booking-") and name.endswith(".ics"):
            booking_id = name[len("booking-") : -len(".ics")]
            return self.item.bookings.filter(pk=booking_id).first()
        return None

    # -- PUT (create / update a booking request) ----------------------------

    def put(self, request, *args, **kwargs):
        if self.level != "event":
            return HttpResponseNotAllowed(["GET", "PROPFIND", "REPORT"])

        event, error = self._parse_put_event(request)
        if error is not None:
            return error

        existing = self._resolve_booking(self.resource)
        if existing is not None:
            return self._update_booking(existing, event)
        return self._create_booking(event)

    def _parse_put_event(self, request):
        """Parse and validate the PUT body. Returns (event, error_response)."""
        try:
            text = request.body.decode("utf-8")
        except UnicodeDecodeError:
            return None, HttpResponseBadRequest("Invalid encoding")

        parsed = parse_calendar(text)
        if not parsed:
            return None, HttpResponseBadRequest("No VEVENT found")
        event = parsed[0]
        if event.dtstart is None:
            return None, HttpResponseBadRequest("VEVENT requires DTSTART")

        # Mirror BookingSerializer: an event without an end time is only allowed
        # when the item permits open-ended rentals.
        if event.dtend is None and not self.item.rental_open_end:
            return None, HttpResponseForbidden(
                "This item does not allow open-ended rentals; an end time is required."
            )
        return event, None

    def _create_booking(self, event):
        # Mirror BookingSerializer: only one pending request per user + item.
        already_pending = Booking.objects.filter(
            item=self.item, user=self.user, status=BookingStatus.PENDING
        ).exists()
        if already_pending:
            return HttpResponse(
                "You already have a pending booking request for this item.",
                status=409,
            )

        booking = Booking(
            item=self.item,
            user=self.user,
            time_from=event.dtstart,
            time_to=event.dtend,
            status=BookingStatus.PENDING,
        )
        try:
            booking.save()
        except IntegrityError:
            return HttpResponse(status=409)

        CalDAVObject.objects.create(
            link=self.link,
            item=self.item,
            booking=booking,
            resource_name=self.resource,
            uid=event.uid or "",
        )
        # Mirror the regular booking flow: a message triggers owner notification.
        Message.objects.create(
            booking=booking,
            sender=self.user,
            message="Booking request created via calendar.",
        )
        resp = HttpResponse(status=201)
        resp["ETag"] = _etag(booking)
        resp["Location"] = self._event_path(self.item_id, self.resource)
        return resp

    def _update_booking(self, booking: Booking, event):
        # Only the booker may modify their own request, and only while it is
        # still pending.
        if booking.user_id != self.user.id:
            return HttpResponseForbidden("Not your booking")
        if booking.status != BookingStatus.PENDING:
            return HttpResponseForbidden("Booking can no longer be changed")
        booking.time_from = event.dtstart
        booking.time_to = event.dtend
        booking.save(update_fields=["time_from", "time_to", "updated_at"])
        resp = HttpResponse(status=204)
        resp["ETag"] = _etag(booking)
        return resp

    # -- DELETE (cancel a pending request) ----------------------------------

    def delete(self, request, *args, **kwargs):
        if self.level != "event":
            return HttpResponseNotAllowed(["GET"])
        booking = self._resolve_booking(self.resource)
        if booking is None:
            raise Http404
        if booking.user_id != self.user.id:
            return HttpResponseForbidden("Not your booking")
        if booking.status not in (BookingStatus.PENDING, BookingStatus.CONFIRMED):
            return HttpResponseForbidden("Booking can no longer be cancelled")
        booking.status = BookingStatus.CANCELLED
        booking.save(update_fields=["status", "updated_at"])
        # Mirror the regular booking flow: a status-change message drives
        # notifications and keeps the audit trail (the cancellation isn't silent).
        Message.objects.create(
            booking=booking,
            sender=self.user,
            message="Booking cancelled via calendar.",
        )
        return HttpResponse(status=204)

    # -- PROPFIND -----------------------------------------------------------

    def propfind(self, request, *args, **kwargs):
        depth = request.headers.get("Depth", "0")
        if self.level == "home":
            responses = [self._home_response()]
            if depth != "0":
                responses.extend(
                    self._calendar_response(item) for item in self._bookable_items()
                )
            return self._multistatus(responses)

        if self.level == "calendar":
            responses = [self._calendar_response(self.item)]
            if depth != "0":
                responses.extend(
                    self._event_response(booking)
                    for booking in feeds.feed_bookings_for_item(self.item)
                )
            return self._multistatus(responses)

        # event
        booking = self._resolve_booking(self.resource)
        if booking is None:
            raise Http404
        return self._multistatus([self._event_response(booking)])

    # -- REPORT -------------------------------------------------------------

    def report(self, request, *args, **kwargs):
        if self.level not in ("calendar", "event"):
            return HttpResponseBadRequest("REPORT not supported here")

        body = request.body.decode("utf-8", errors="replace")
        # calendar-multiget references specific hrefs; calendar-query returns all.
        requested_names = self._extract_hrefs(body)
        bookings = []
        if "calendar-multiget" in body and requested_names:
            for name in requested_names:
                booking = self._resolve_booking(name)
                if booking is not None:
                    bookings.append(booking)
        else:
            bookings = list(feeds.feed_bookings_for_item(self.item))

        responses = [self._event_response(b, include_data=True) for b in bookings]
        return self._multistatus(responses)

    @staticmethod
    def _extract_hrefs(body: str) -> list[str]:
        hrefs = re.findall(r"<[^>]*href[^>]*>([^<]+)</[^>]*href[^>]*>", body, re.I)
        return [href.rstrip("/").split("/")[-1] for href in hrefs]

    # -- XML response builders ---------------------------------------------

    def _multistatus(self, responses: list[str]) -> HttpResponse:
        xml = (
            '<?xml version="1.0" encoding="utf-8"?>\n'
            f'<D:multistatus xmlns:D="{DAV_NS}" xmlns:C="{CALDAV_NS}">'
            + "".join(responses)
            + "</D:multistatus>"
        )
        return HttpResponse(
            xml, status=207, content_type='application/xml; charset="utf-8"'
        )

    def _propstat_ok(self, props: str) -> str:
        return (
            "<D:propstat>"
            f"<D:prop>{props}</D:prop>"
            "<D:status>HTTP/1.1 200 OK</D:status>"
            "</D:propstat>"
        )

    def _home_response(self) -> str:
        href = self._home_path()
        principal = (
            f"<D:current-user-principal><D:href>{xml_escape(href)}</D:href>"
            "</D:current-user-principal>"
        )
        home_set = (
            f"<C:calendar-home-set><D:href>{xml_escape(href)}</D:href>"
            "</C:calendar-home-set>"
        )
        props = (
            "<D:resourcetype><D:collection/></D:resourcetype>"
            f"<D:displayname>{xml_escape(str(self.user))}</D:displayname>"
            f"{principal}{home_set}"
        )
        return (
            f"<D:response><D:href>{xml_escape(href)}</D:href>"
            f"{self._propstat_ok(props)}</D:response>"
        )

    def _calendar_response(self, item) -> str:
        href = self._calendar_path(item.id)
        ctag = self._calendar_ctag(item)
        props = (
            "<D:resourcetype><D:collection/><C:calendar/></D:resourcetype>"
            f"<D:displayname>{xml_escape(item.name or 'Item')}</D:displayname>"
            "<C:supported-calendar-component-set>"
            '<C:comp name="VEVENT"/>'
            "</C:supported-calendar-component-set>"
            "<C:calendar-description>"
            f"{xml_escape(item.name or '')}"
            "</C:calendar-description>"
            f'<CS:getctag xmlns:CS="http://calendarserver.org/ns/">{ctag}</CS:getctag>'
        )
        return (
            f"<D:response><D:href>{xml_escape(href)}</D:href>"
            f"{self._propstat_ok(props)}</D:response>"
        )

    def _calendar_ctag(self, item) -> str:
        latest = (
            item.bookings.order_by("-updated_at")
            .values_list("updated_at", flat=True)
            .first()
        )
        if latest is None:
            return "0"
        return str(int(latest.timestamp()))

    def _event_response(self, booking: Booking, *, include_data: bool = False) -> str:
        name = self._resource_name_for(booking)
        href = self._event_path(booking.item_id, name)
        etag = xml_escape(_etag(booking))
        props = (
            f"<D:getetag>{etag}</D:getetag>"
            "<D:getcontenttype>text/calendar; component=vevent</D:getcontenttype>"
        )
        if include_data:
            events = feeds.bookings_to_events(
                [booking], summary_field="item", include_booker=True
            )
            ics = build_calendar(booking.item.name or "Item", events)
            props += f"<C:calendar-data>{xml_escape(ics)}</C:calendar-data>"
        return (
            f"<D:response><D:href>{xml_escape(href)}</D:href>"
            f"{self._propstat_ok(props)}</D:response>"
        )


def caldav_root_options(request, secret: str):
    """Bare OPTIONS so clients can probe before discovering the hierarchy."""
    view = CalDAVView()
    view.setup(request, secret=secret)
    return view.options(request)
