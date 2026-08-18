"""Tests for pricing an item in community coins instead of money.

Covers the owner-facing choice, added alongside the existing voluntary
post-transaction valuation (see ``bubble.coins``): when listing an item for
sale or rent, the price can be denominated in the default currency or
directly in community coins.
"""

from decimal import Decimal

import pytest
from django.contrib.auth.models import Group
from django.db import IntegrityError
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from bubble.core.permissions_config import DefaultGroup
from bubble.items.models import Item, ItemStatus, PricingUnit, SalesType
from bubble.users.tests.factories import UserFactory

LIST_URL = reverse("api:item-list")


@pytest.fixture
def owner(db):
    user = UserFactory()
    group, _ = Group.objects.get_or_create(name=DefaultGroup.DEFAULT)
    user.groups.add(group)
    return user


@pytest.fixture
def client_as(db):
    def _client(user=None):
        client = APIClient()
        if user is not None:
            client.force_authenticate(user)
        return client

    return _client


def _detail_url(item_id):
    return reverse("api:item-detail", kwargs={"id": item_id})


def test_item_can_be_created_priced_in_coins(client_as, owner):
    response = client_as(owner).post(
        LIST_URL,
        {
            "name": "Power drill",
            "category": "tools",
            "sales_type": "sell",
            "price": "15.00",
            "price_unit": "coin",
        },
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["price_unit"] == "coin"

    item = Item.objects.get(pk=response.data["id"])
    assert item.price_unit == PricingUnit.COIN
    assert item.price.amount == Decimal("15.00")


def test_price_unit_defaults_to_money(client_as, owner):
    response = client_as(owner).post(
        LIST_URL,
        {"name": "Ladder", "category": "tools", "sales_type": "sell", "price": "10.00"},
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["price_unit"] == "money"


def test_rental_can_be_priced_in_coins(client_as, owner):
    response = client_as(owner).post(
        LIST_URL,
        {
            "name": "Camping tent",
            "category": "sports",
            "sales_type": "rent",
            "price": "3.00",
            "rental_period": "d",
            "price_unit": "coin",
        },
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["price_unit"] == "coin"


def test_donate_item_cannot_be_priced_in_coins(client_as, owner):
    """Donations have no price at all, so there is nothing to denominate."""
    response = client_as(owner).post(
        LIST_URL,
        {
            "name": "Old bookshelf",
            "category": "furniture",
            "sales_type": "donate",
            "price_unit": "coin",
        },
        format="json",
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["price"] is None
    assert response.data["price_unit"] == "money"


def test_clearing_the_price_resets_the_unit_to_money(client_as, owner):
    item_response = client_as(owner).post(
        LIST_URL,
        {
            "name": "Board game",
            "category": "toys",
            "sales_type": "sell",
            "price": "8.00",
            "price_unit": "coin",
        },
        format="json",
    )
    item_id = item_response.data["id"]

    response = client_as(owner).patch(
        _detail_url(item_id), {"price": None}, format="json"
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["price"] is None
    assert response.data["price_unit"] == "money"


def test_switching_sales_type_to_borrow_clears_coin_unit(client_as, owner):
    """Auto-clearing the price on sales_type change also resets the unit."""
    item_response = client_as(owner).post(
        LIST_URL,
        {
            "name": "Projector",
            "category": "electronics",
            "sales_type": "rent",
            "price": "5.00",
            "rental_period": "d",
            "price_unit": "coin",
        },
        format="json",
    )
    item_id = item_response.data["id"]

    response = client_as(owner).patch(
        _detail_url(item_id), {"sales_type": "borrow"}, format="json"
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["price"] is None
    assert response.data["price_unit"] == "money"


def test_database_rejects_a_coin_unit_without_a_price(db, owner):
    """The DB constraint is the last line of defence beneath the serializer."""
    with pytest.raises(IntegrityError):
        Item.objects.create(
            user=owner,
            name="Broken constraint",
            category="tools",
            sales_type=SalesType.SELL,
            status=ItemStatus.DRAFT,
            price=None,
            price_unit=PricingUnit.COIN,
        )
