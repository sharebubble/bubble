"""Test factories for bookings."""

import factory
from factory.django import DjangoModelFactory

from bubble.bookings.models import Booking, BookingStatus
from bubble.items.models import Item, ItemStatus, SalesType
from bubble.users.tests.factories import UserFactory


class ItemFactory(DjangoModelFactory):
    """Factory for creating test items."""

    class Meta:
        model = Item

    user = factory.SubFactory(UserFactory)
    name = factory.Sequence(lambda n: f"Test Item {n}")
    description = factory.Faker("text", max_nb_chars=200)
    category = "tools"
    status = ItemStatus.AVAILABLE
    rental_self_service = False
    sales_type = SalesType.RENT
    price = "10.00"


class SelfServiceItemFactory(ItemFactory):
    """Factory for creating items with self-service enabled."""

    rental_self_service = True
    sales_type = SalesType.RENT
    price = "10.00"


class BookingFactory(DjangoModelFactory):
    """Factory for creating test bookings."""

    class Meta:
        model = Booking

    user = factory.SubFactory(UserFactory)
    item = factory.SubFactory(ItemFactory)
    status = BookingStatus.PENDING
