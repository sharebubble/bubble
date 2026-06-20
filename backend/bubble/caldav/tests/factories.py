"""Shared factories for caldav tests."""

import factory
from factory.django import DjangoModelFactory

from bubble.items.models import Item, ItemStatus, SalesType


class RentItemFactory(DjangoModelFactory):
    """A bookable item lent for money."""

    class Meta:
        model = Item

    user = factory.SubFactory("bubble.users.tests.factories.UserFactory")
    name = factory.Sequence(lambda n: f"Rentable {n}")
    category = "tools"
    status = ItemStatus.AVAILABLE
    sales_type = SalesType.RENT
    price = "10.00"
    visibility = 0  # PUBLIC


class BorrowItemFactory(DjangoModelFactory):
    """A bookable item that is free to lend (borrow)."""

    class Meta:
        model = Item

    user = factory.SubFactory("bubble.users.tests.factories.UserFactory")
    name = factory.Sequence(lambda n: f"Borrowable {n}")
    category = "tools"
    status = ItemStatus.AVAILABLE
    sales_type = SalesType.BORROW
    price = None
    visibility = 0  # PUBLIC


class SellItemFactory(DjangoModelFactory):
    """A non-bookable item (for sale)."""

    class Meta:
        model = Item

    user = factory.SubFactory("bubble.users.tests.factories.UserFactory")
    name = factory.Sequence(lambda n: f"Sellable {n}")
    category = "tools"
    status = ItemStatus.AVAILABLE
    sales_type = SalesType.SELL
    price = "20.00"
    visibility = 0  # PUBLIC
