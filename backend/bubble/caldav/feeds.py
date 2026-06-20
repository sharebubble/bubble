"""Selection logic: which items are bookable, which bookings appear in feeds,
and how a booking maps to a calendar event.
"""

from django.db.models import Q, QuerySet
from guardian.shortcuts import get_objects_for_user

from bubble.bookings.models import Booking, BookingStatus
from bubble.items.models import Item, VisibilityType

from .ical import VEvent

# Only items that can actually be booked: "borrow" (free to lend) and
# "rent" (lent for money). Sell/donate/want_* are not bookable.
BOOKABLE_SALES_TYPES = ("rent", "borrow")

# Booking states that are worth showing on a calendar.
FEED_BOOKING_STATUSES = (
    BookingStatus.PENDING,
    BookingStatus.CONFIRMED,
    BookingStatus.COMPLETED,
)

# Map a booking status to an iCalendar VEVENT STATUS.
_STATUS_MAP = {
    BookingStatus.PENDING: "TENTATIVE",
    BookingStatus.CONFIRMED: "CONFIRMED",
    BookingStatus.COMPLETED: "CONFIRMED",
    BookingStatus.CANCELLED: "CANCELLED",
    BookingStatus.REJECTED: "CANCELLED",
}


def is_bookable(item: Item) -> bool:
    return item.sales_type in BOOKABLE_SALES_TYPES


def vevent_status_for(booking: Booking) -> str:
    return _STATUS_MAP.get(booking.status, "CONFIRMED")


def booker_display_name(booking: Booking) -> str:
    """Human-readable name of whoever made the booking."""
    if booking.user_id and booking.user:
        return booking.user.name or booking.user.get_username()
    if booking.remote_booker_actor_id and booking.remote_booker_actor:
        actor = booking.remote_booker_actor
        return (
            getattr(actor, "preferred_username", None)
            or getattr(actor, "name", None)
            or str(actor)
        )
    return "Unknown"


def event_uid(booking: Booking) -> str:
    return f"booking-{booking.id}@bubble"


def feed_bookings_for_item(item: Item):
    """Bookings of a single item that should appear in a feed."""
    return (
        item.bookings.filter(status__in=FEED_BOOKING_STATUSES)
        .select_related("user", "remote_booker_actor")
        .order_by("time_from")
    )


def bookings_to_events(bookings, *, summary: str, booker_in_description: bool):
    """Convert bookings to VEvents.

    ``summary`` selects what each event's SUMMARY (the title shown in the
    calendar) contains:
      * ``"booker"`` — the name of the person who booked (used by the per-item
        feed/calendar, whose calendar name is already the item name).
      * ``"item"`` — the booked item's name (used by the collection feed, where
        the calendar spans many items).
    When ``booker_in_description`` is set, the DESCRIPTION carries the booker's
    name as well.
    """
    events = []
    for booking in bookings:
        if booking.time_from is None:
            continue
        booker = booker_display_name(booking)
        if summary == "booker":
            summary_text = booker or "Booked"
        else:
            summary_text = booking.item.name or "Booking"
        description = booker if booker_in_description else ""
        events.append(
            VEvent(
                uid=event_uid(booking),
                dtstart=booking.time_from,
                dtend=booking.time_to,
                summary=summary_text,
                description=description,
                status=vevent_status_for(booking),
                dtstamp=booking.updated_at or booking.created_at,
                last_modified=booking.updated_at,
            )
        )
    return events


def bookable_items_for_user(user) -> QuerySet[Item]:
    """Bookable, published items the given (authenticated) user may view.

    Mirrors the visibility rules of the public item API: PUBLIC and
    AUTHENTICATED items are visible to any logged-in user, while SPECIFIC and
    PRIVATE items require an explicit ``view_item`` permission.
    """
    base = Item.objects.published().filter(sales_type__in=BOOKABLE_SALES_TYPES)

    explicitly_visible = get_objects_for_user(
        user, "items.view_item", accept_global_perms=False
    ).values_list("pk", flat=True)

    return base.filter(
        Q(visibility__in=[VisibilityType.PUBLIC, VisibilityType.AUTHENTICATED])
        | Q(visibility=VisibilityType.SPECIFIC, pk__in=explicitly_visible)
        | Q(visibility=VisibilityType.PRIVATE, pk__in=explicitly_visible)
    ).select_related("user")
