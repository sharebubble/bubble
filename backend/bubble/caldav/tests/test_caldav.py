"""Tests for the private read-write CalDAV endpoint."""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework import status

from bubble.bookings.models import Booking, BookingStatus
from bubble.caldav.models import CalDAVObject, CalendarLink
from bubble.users.tests.factories import UserFactory

from .factories import BorrowItemFactory, RentItemFactory


class CalDAVProtocolTests(TestCase):
    def setUp(self):
        self.owner = UserFactory()
        self.user = UserFactory(name="Carol")
        self.item = BorrowItemFactory(user=self.owner, name="Library Book")
        self.link = CalendarLink.get_or_create_for_user(self.user)
        self.home = f"/caldav/dav/{self.link.secret}/"
        self.calendar = f"{self.home}{self.item.id}/"

    # -- discovery ----------------------------------------------------------

    def test_options_advertises_caldav(self):
        resp = self.client.options(self.home)
        assert resp.status_code == status.HTTP_200_OK
        assert "calendar-access" in resp["DAV"]

    def test_propfind_home_lists_bookable_items(self):
        resp = self.client.generic("PROPFIND", self.home, HTTP_DEPTH="1")
        assert resp.status_code == status.HTTP_207_MULTI_STATUS
        body = resp.content.decode()
        assert "calendar-home-set" in body
        assert str(self.item.id) in body
        assert "Library Book" in body

    def test_propfind_unknown_secret_404(self):
        resp = self.client.generic("PROPFIND", "/caldav/dav/nope/", HTTP_DEPTH="0")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_propfind_calendar_lists_events(self):
        now = timezone.now()
        Booking.objects.create(
            item=self.item,
            user=self.user,
            status=BookingStatus.CONFIRMED,
            time_from=now,
            time_to=now + timedelta(hours=1),
        )
        resp = self.client.generic("PROPFIND", self.calendar, HTTP_DEPTH="1")
        assert resp.status_code == status.HTTP_207_MULTI_STATUS
        body = resp.content.decode()
        assert "getetag" in body

    # -- creating a booking via PUT ----------------------------------------

    def _ics(self, uid, start, end, summary="Borrow request"):
        return (
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\n"
            f"UID:{uid}\r\n"
            f"DTSTART:{start}\r\n"
            f"DTEND:{end}\r\n"
            f"SUMMARY:{summary}\r\n"
            "END:VEVENT\r\nEND:VCALENDAR\r\n"
        )

    def test_put_creates_pending_booking(self):
        url = f"{self.calendar}my-event.ics"
        body = self._ics("client-uid-1", "20260616T080000Z", "20260616T100000Z")
        resp = self.client.generic("PUT", url, data=body, content_type="text/calendar")
        assert resp.status_code == status.HTTP_201_CREATED, resp.content
        booking = Booking.objects.get(item=self.item, user=self.user)
        assert booking.status == BookingStatus.PENDING
        obj = CalDAVObject.objects.get(booking=booking)
        assert obj.resource_name == "my-event.ics"
        # The created event is now retrievable via GET.
        get_resp = self.client.get(url)
        assert get_resp.status_code == status.HTTP_200_OK
        assert "client-uid-1" not in get_resp.content.decode()  # UID is normalised
        assert "STATUS:TENTATIVE" in get_resp.content.decode()

    def test_put_then_delete_cancels_booking(self):
        url = f"{self.calendar}cancel-me.ics"
        self.client.generic(
            "PUT",
            url,
            data=self._ics("u2", "20260620T080000Z", "20260620T090000Z"),
            content_type="text/calendar",
        )
        booking = Booking.objects.get(item=self.item, user=self.user)
        assert booking.status == BookingStatus.PENDING

        resp = self.client.delete(url)
        assert resp.status_code == status.HTTP_204_NO_CONTENT
        booking.refresh_from_db()
        assert booking.status == BookingStatus.CANCELLED

    def test_put_update_changes_times(self):
        url = f"{self.calendar}move.ics"
        self.client.generic(
            "PUT",
            url,
            data=self._ics("u3", "20260622T080000Z", "20260622T090000Z"),
            content_type="text/calendar",
        )
        self.client.generic(
            "PUT",
            url,
            data=self._ics("u3", "20260622T140000Z", "20260622T150000Z"),
            content_type="text/calendar",
        )
        bookings = Booking.objects.filter(item=self.item, user=self.user)
        assert bookings.count() == 1
        booking = bookings.first()
        expected_hour = 14
        assert booking.time_from.hour == expected_hour

    def test_report_multiget_returns_calendar_data(self):
        now = timezone.now()
        booking = Booking.objects.create(
            item=self.item,
            user=self.user,
            status=BookingStatus.CONFIRMED,
            time_from=now,
            time_to=now + timedelta(hours=1),
        )
        resource = f"booking-{booking.id}.ics"
        report_body = (
            '<?xml version="1.0"?>'
            '<C:calendar-multiget xmlns:D="DAV:" '
            'xmlns:C="urn:ietf:params:xml:ns:caldav">'
            "<D:prop><D:getetag/><C:calendar-data/></D:prop>"
            f"<D:href>{self.calendar}{resource}</D:href>"
            "</C:calendar-multiget>"
        )
        resp = self.client.generic(
            "REPORT", self.calendar, data=report_body, content_type="application/xml"
        )
        assert resp.status_code == status.HTTP_207_MULTI_STATUS
        assert "BEGIN:VCALENDAR" in resp.content.decode()

    def test_item_not_visible_is_hidden(self):
        # An item owned by someone else with PRIVATE visibility must not appear.
        from bubble.items.models import VisibilityType

        private_item = RentItemFactory(
            user=self.owner, name="Secret", visibility=VisibilityType.PRIVATE
        )
        resp = self.client.generic("PROPFIND", self.home, HTTP_DEPTH="1")
        assert "Secret" not in resp.content.decode()
        # And its calendar 404s.
        resp2 = self.client.generic(
            "PROPFIND", f"{self.home}{private_item.id}/", HTTP_DEPTH="0"
        )
        assert resp2.status_code == status.HTTP_404_NOT_FOUND
