"""Test factories for the ledger."""

from datetime import timedelta

import factory
from django.utils import timezone

from bubble.bookings.models import BookingStatus
from bubble.bookings.tests.factories import BookingFactory, ItemFactory
from bubble.items.models import ItemStatus, SalesType


class FreeSaleItemFactory(ItemFactory):
    """An item given away for free (a zero-price sale)."""

    sales_type = SalesType.SELL
    price = "0.00"
    status = ItemStatus.AVAILABLE


class FreeRentalItemFactory(ItemFactory):
    """A rental item offered without a price, billed per day."""

    sales_type = SalesType.RENT
    price = None
    rental_period = "d"
    status = ItemStatus.AVAILABLE


class PricedItemFactory(ItemFactory):
    """An item with a real listed price."""

    sales_type = SalesType.SELL
    price = "20.00"
    status = ItemStatus.AVAILABLE


class CompletedBookingFactory(BookingFactory):
    """A booking that has run its course — the point payments are recorded.

    Each booking gets its own hour-long window so that tests which flip the
    status to CONFIRMED do not trip the overlapping-bookings exclusion
    constraint.
    """

    status = BookingStatus.COMPLETED
    time_from = factory.Sequence(
        lambda n: timezone.now() - timedelta(hours=2 * (n + 1))
    )
    time_to = factory.LazyAttribute(lambda o: o.time_from + timedelta(hours=1))
