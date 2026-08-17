from __future__ import annotations

import logging

from django.db.models import Exists, OuterRef, Q
from django.utils import timezone
from huey import crontab
from huey.contrib.djhuey import periodic_task

from bubble.bookings.models import Booking, BookingStatus
from bubble.items.models import Item, ItemStatus

logger = logging.getLogger(__name__)


@periodic_task(crontab(minute="*/10"))
def check_bookings_active() -> None:
    """Periodic task: keep self-service rentals in sync with their schedule.

    Runs every 10 minutes. Only self-service items are time-driven; every other
    item now relies on the explicit handover/return confirmation flow, so this
    task must never touch non-self-service items.

    For confirmed bookings on self-service items that are currently active
    (time_from <= now <= time_to or time_to is null), set the linked item to
    ItemStatus.RENTED if it is currently AVAILABLE/RESERVED.

    For self-service items that are RENTED but have no remaining active confirmed
    booking (time_to < now), set them back to ItemStatus.AVAILABLE.
    """
    now = timezone.now()
    logger.debug("Running check_bookings_active task at %s", now)

    # Query for active confirmed bookings
    active_q = (
        Q(status=BookingStatus.CONFIRMED)
        & Q(time_from__lte=now)
        & (Q(time_to__isnull=True) | Q(time_to__gte=now))
    )

    active_item_ids_qs = Booking.objects.filter(active_q).values_list(
        "item_id", flat=True
    )
    # Set self-service items that are AVAILABLE/RESERVED -> RENTED
    updated = Item.objects.filter(
        id__in=active_item_ids_qs,
        rental_self_service=True,
        status__in=[ItemStatus.AVAILABLE, ItemStatus.RESERVED],
    )
    for item in updated:
        item.status = ItemStatus.RENTED
        item.save(update_fields=["status"])
        logger.debug("Marked item %d as RENTED", item.id)

    # Annotate with active_booking_count per item (uses related_name 'bookings')
    active_bookings = Booking.objects.filter(active_q, item=OuterRef("pk"))
    items_to_free_qs = Item.objects.filter(
        status=ItemStatus.RENTED, rental_self_service=True
    ).filter(~Exists(active_bookings))

    for item in items_to_free_qs:
        item.status = ItemStatus.AVAILABLE
        item.save(update_fields=["status"])
        logger.debug("Item %d marked as AVAILABLE", item.id)
