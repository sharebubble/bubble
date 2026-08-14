"""Test factories for community-coin valuations."""

import factory
from factory.django import DjangoModelFactory

from bubble.bookings.models import BookingStatus
from bubble.bookings.tests.factories import BookingFactory, ItemFactory
from bubble.coins.models import CoinValuation
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


class SettledBookingFactory(BookingFactory):
    """A confirmed booking — a transaction that actually happened."""

    status = BookingStatus.CONFIRMED


class CoinValuationFactory(DjangoModelFactory):
    """Factory for recorded coin valuations."""

    class Meta:
        model = CoinValuation

    booking = factory.SubFactory(SettledBookingFactory)
    item = factory.SelfAttribute("booking.item")
    user = factory.SelfAttribute("booking.user")
    amount = "10.00"
