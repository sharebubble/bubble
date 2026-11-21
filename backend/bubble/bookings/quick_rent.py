"""QR-code quick rental: scan once to rent an item, scan again to return it.

An owner prints a QR code (see ``bubble.items.qr_pdf``) and sticks it on the
item. Scanning it opens the item's quick-rent page, which calls
:func:`toggle_quick_rent` for the signed-in user:

- nobody has the item → an open-ended, confirmed booking starting now is
  created for the user (``RENTED``),
- the user has it → their running booking ends now (``RETURNED``),
- someone else has it → nothing changes and the current booking is returned so
  the user can see who has it (``UNAVAILABLE``).

Only self-service (auto-approved) rentals that allow open-ended rentals
qualify: there is no owner around to confirm a scan in front of the item, and
the return date is only known once the item is scanned again.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from rest_framework.exceptions import ValidationError

from bubble.bookings.models import Booking, BookingStatus, Message
from bubble.items.models import Item, ItemStatus, SalesType

if TYPE_CHECKING:
    from datetime import datetime

    from bubble.users.models import User

QUICK_RENT_SALES_TYPES = (SalesType.RENT, SalesType.BORROW)
ACTIVE_STATUSES = (BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS)


class QuickRentResult:
    RENTED = "rented"
    RETURNED = "returned"
    UNAVAILABLE = "unavailable"

    choices = (RENTED, RETURNED, UNAVAILABLE)


class QuickRentError(ValidationError):
    """The quick rental could not be carried out (rendered as HTTP 400)."""

    def __init__(self, message):
        super().__init__({"non_field_errors": [message]})


@dataclass
class QuickRentOutcome:
    result: str
    booking: Booking
    # Start of the next confirmed booking by someone else, so a renter knows
    # by when the item has to be back.
    next_booking_at: datetime | None = None


def supports_quick_rent(item: Item) -> bool:
    """Whether the item can be rented and returned by scanning its QR code."""
    return (
        item.rental_self_service
        and item.rental_open_end
        and item.sales_type in QUICK_RENT_SALES_TYPES
    )


def _active_bookings(item: Item, now: datetime):
    return (
        Booking.objects.filter(
            item=item, status__in=ACTIVE_STATUSES, time_from__lte=now
        )
        .filter(Q(time_to__isnull=True) | Q(time_to__gte=now))
        .select_related("item", "user", "remote_booker_actor")
        .order_by("time_from")
    )


def _next_booking_at(item: Item, user: User, now: datetime) -> datetime | None:
    upcoming = (
        Booking.objects.filter(item=item, status__in=ACTIVE_STATUSES, time_from__gt=now)
        .exclude(user=user)
        .order_by("time_from")
        .first()
    )
    return upcoming.time_from if upcoming else None


def is_open_ended_running(booking: Booking, now: datetime | None = None) -> bool:
    """Whether the booking is an approved rental without an end date that has
    already started, i.e. one that only ends when the item is returned."""
    now = now or timezone.now()
    return (
        booking.status in ACTIVE_STATUSES
        and booking.time_to is None
        and booking.time_from is not None
        and booking.time_from <= now
    )


def end_booking_now(booking: Booking, user: User, message: str) -> Booking:
    """Return the item: end the running booking now and complete it.

    The item is freed by the ``update_item_status`` signal. ``message`` is
    recorded as a booking message from ``user`` (which also notifies the other
    side).
    """
    booking.time_to = timezone.now()
    booking.status = BookingStatus.COMPLETED
    booking.save(update_fields=["time_to", "status", "updated_at"])
    Message.objects.create(booking=booking, sender=user, message=message)
    return booking


def toggle_quick_rent(item: Item, user: User) -> QuickRentOutcome:
    """Rent the item to ``user``, or return it if ``user`` already has it."""
    if not supports_quick_rent(item):
        raise QuickRentError(_("This item cannot be rented via QR code."))
    if item.status not in (ItemStatus.AVAILABLE, ItemStatus.RENTED):
        raise QuickRentError(_("This item is currently not available for rent."))

    with transaction.atomic():
        # Serialise concurrent scans of the same item so two people can't
        # both pick it up at the same moment.
        Item.objects.select_for_update().filter(pk=item.pk).first()
        now = timezone.now()
        active = _active_bookings(item, now)

        own = active.filter(user=user).first()
        if own is not None:
            end_booking_now(own, user, _("Item returned via QR code."))
            return QuickRentOutcome(QuickRentResult.RETURNED, own)

        current = active.first()
        if current is not None:
            return QuickRentOutcome(QuickRentResult.UNAVAILABLE, current)

        try:
            # Savepoint: a constraint violation must not poison the
            # request-wide transaction (ATOMIC_REQUESTS).
            with transaction.atomic():
                booking = Booking.objects.create(
                    item=item,
                    user=user,
                    status=BookingStatus.CONFIRMED,
                    time_from=now,
                    time_to=None,
                )
        except IntegrityError as exc:
            # Another open-ended booking for this item already exists.
            raise QuickRentError(
                _("This item is already reserved by someone else.")
            ) from exc

        Message.objects.create(
            booking=booking, sender=user, message=_("Item rented via QR code.")
        )
        return QuickRentOutcome(
            QuickRentResult.RENTED, booking, _next_booking_at(item, user, now)
        )
