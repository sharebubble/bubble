"""API tests for community-coin valuations.

Covers the flow behind the post-transaction prompt: who may record what a free
transaction was worth, how a rental rate becomes a total, and how the resulting
track record is exposed to everyone who can see the item.
"""

from datetime import timedelta

import pytest
from django.contrib.auth.models import Group
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from bubble.bookings.models import BookingStatus
from bubble.bookings.tests.factories import BookingFactory, ItemFactory
from bubble.coins.models import CoinValuation
from bubble.coins.tests.factories import (
    FreeRentalItemFactory,
    FreeSaleItemFactory,
    SettledBookingFactory,
)
from bubble.core.permissions_config import DefaultGroup
from bubble.items.models import ItemStatus, SalesType, VisibilityType
from bubble.users.tests.factories import UserFactory

LIST_URL = reverse("api:coin-valuation-list")
SUMMARY_URL = reverse("api:coin-valuation-summary")
SUGGESTION_URL = reverse("api:coin-valuation-suggestion")

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def booker(db):
    """The person who got the item and is asked what it was worth."""
    user = UserFactory()
    group, _ = Group.objects.get_or_create(name=DefaultGroup.DEFAULT)
    user.groups.add(group)
    return user


@pytest.fixture
def stranger(db):
    """Another community member, uninvolved in the transaction."""
    return UserFactory()


@pytest.fixture
def free_sale_item(db):
    return FreeSaleItemFactory()


@pytest.fixture
def free_rental_item(db):
    """A free rental billed per day."""
    return FreeRentalItemFactory()


@pytest.fixture
def sale_booking(free_sale_item, booker):
    return SettledBookingFactory(item=free_sale_item, user=booker, time_to=None)


@pytest.fixture
def rental_booking(free_rental_item, booker):
    """A settled two-day rental."""
    time_from = timezone.now()
    return SettledBookingFactory(
        item=free_rental_item,
        user=booker,
        time_from=time_from,
        time_to=time_from + timedelta(days=2),
    )


@pytest.fixture
def client_as(db):
    def _client(user=None):
        client = APIClient()
        if user is not None:
            client.force_authenticate(user)
        return client

    return _client


# ---------------------------------------------------------------------------
# Recording a valuation
# ---------------------------------------------------------------------------


def test_booker_can_value_a_free_sale(client_as, booker, sale_booking):
    response = client_as(booker).post(
        LIST_URL, {"booking": str(sale_booking.id), "amount": "12.50"}, format="json"
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["amount"] == "12.50"
    assert response.data["rate"] is None
    assert response.data["rental_period"] == ""

    valuation = CoinValuation.objects.get()
    assert valuation.item == sale_booking.item
    assert valuation.user == booker


def test_rental_rate_is_multiplied_by_the_booked_duration(
    client_as, booker, rental_booking
):
    """The slider sets the daily price; the stored total covers the booking."""
    response = client_as(booker).post(
        LIST_URL, {"booking": str(rental_booking.id), "rate": "5"}, format="json"
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["rate"] == "5.00"
    # 5 coins per day over two booked days
    assert response.data["amount"] == "10.00"
    assert response.data["rental_period"] == "d"


def test_open_ended_rental_falls_back_to_the_bare_rate(
    client_as, booker, free_rental_item
):
    """Without an end date there is no duration, so the rate is the total."""
    booking = SettledBookingFactory(item=free_rental_item, user=booker, time_to=None)

    response = client_as(booker).post(
        LIST_URL, {"booking": str(booking.id), "rate": "7.25"}, format="json"
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["amount"] == "7.25"


def test_rental_requires_a_rate(client_as, booker, rental_booking):
    response = client_as(booker).post(
        LIST_URL, {"booking": str(rental_booking.id), "amount": "9"}, format="json"
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "rate" in response.data


def test_sale_requires_an_amount(client_as, booker, sale_booking):
    response = client_as(booker).post(
        LIST_URL, {"booking": str(sale_booking.id)}, format="json"
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "amount" in response.data


def test_negative_amounts_are_rejected(client_as, booker, sale_booking):
    response = client_as(booker).post(
        LIST_URL, {"booking": str(sale_booking.id), "amount": "-1"}, format="json"
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST


def test_only_the_booker_can_value_a_transaction(client_as, stranger, sale_booking):
    response = client_as(stranger).post(
        LIST_URL, {"booking": str(sale_booking.id), "amount": "5"}, format="json"
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert not CoinValuation.objects.exists()


def test_anonymous_users_cannot_value(client_as, sale_booking):
    response = client_as().post(
        LIST_URL, {"booking": str(sale_booking.id), "amount": "5"}, format="json"
    )

    assert response.status_code in (
        status.HTTP_401_UNAUTHORIZED,
        status.HTTP_403_FORBIDDEN,
    )


def test_unsettled_booking_cannot_be_valued(client_as, booker, free_sale_item):
    """Nothing has changed hands yet while the request is still pending."""
    booking = BookingFactory(
        item=free_sale_item,
        user=booker,
        status=BookingStatus.PENDING,
        time_to=None,
    )

    response = client_as(booker).post(
        LIST_URL, {"booking": str(booking.id), "amount": "5"}, format="json"
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST


def test_priced_item_cannot_be_valued(client_as, booker):
    """Items with a real price are paid for in money, not in coins."""
    item = ItemFactory(sales_type=SalesType.SELL, price="10.00")
    booking = SettledBookingFactory(item=item, user=booker, time_to=None)

    response = client_as(booker).post(
        LIST_URL, {"booking": str(booking.id), "amount": "5"}, format="json"
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST


def test_coin_priced_item_cannot_be_valued(client_as, booker):
    """A fixed coin price is a binding listing term, not a voluntary valuation."""
    item = ItemFactory(sales_type=SalesType.SELL, price="10.00", price_unit="coin")
    booking = SettledBookingFactory(item=item, user=booker, time_to=None)

    response = client_as(booker).post(
        LIST_URL, {"booking": str(booking.id), "amount": "5"}, format="json"
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST


def test_valuing_again_replaces_the_previous_value(client_as, booker, sale_booking):
    """Correcting a value is an edit of the entry, not a second transaction."""
    client = client_as(booker)
    payload = {"booking": str(sale_booking.id), "amount": "5"}

    client.post(LIST_URL, payload, format="json")
    response = client.post(LIST_URL, {**payload, "amount": "8"}, format="json")

    assert response.status_code == status.HTTP_201_CREATED
    assert CoinValuation.objects.count() == 1
    assert str(CoinValuation.objects.get().amount) == "8.00"


# ---------------------------------------------------------------------------
# Track record
# ---------------------------------------------------------------------------


def test_track_record_is_visible_to_other_users(
    client_as, booker, stranger, sale_booking
):
    client_as(booker).post(
        LIST_URL, {"booking": str(sale_booking.id), "amount": "12"}, format="json"
    )

    response = client_as(stranger).get(LIST_URL, {"item": str(sale_booking.item_id)})

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 1
    entry = response.data["results"][0]
    assert entry["amount"] == "12.00"
    assert entry["user"]["username"] == booker.username
    # The track record is as public as the item — it must not leak contact data
    assert "email" not in entry["user"]


def test_track_record_survives_the_item_being_sold(
    client_as, booker, stranger, free_sale_item, sale_booking
):
    """Being sold on is when a free item's history matters most."""
    client_as(booker).post(
        LIST_URL, {"booking": str(sale_booking.id), "amount": "12"}, format="json"
    )
    free_sale_item.status = ItemStatus.SOLD
    free_sale_item.save(update_fields=["status"])

    response = client_as(stranger).get(LIST_URL, {"item": str(free_sale_item.id)})

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 1


def test_rental_in_progress_can_be_valued(client_as, booker, free_rental_item):
    """A rental whose handover is confirmed is under way, not unsettled."""
    booking = SettledBookingFactory(
        item=free_rental_item,
        user=booker,
        status=BookingStatus.IN_PROGRESS,
        time_to=None,
    )

    response = client_as(booker).post(
        LIST_URL, {"booking": str(booking.id), "rate": "4"}, format="json"
    )

    assert response.status_code == status.HTTP_201_CREATED


def test_track_record_requires_an_item(client_as, stranger):
    response = client_as(stranger).get(LIST_URL)

    assert response.status_code == status.HTTP_400_BAD_REQUEST


def test_track_record_of_an_invisible_item_is_not_exposed(
    client_as, stranger, booker, free_sale_item
):
    """A private item keeps its track record private too."""
    free_sale_item.visibility = VisibilityType.PRIVATE
    free_sale_item.save(update_fields=["visibility"])
    booking = SettledBookingFactory(item=free_sale_item, user=booker, time_to=None)
    client_as(booker).post(
        LIST_URL, {"booking": str(booking.id), "amount": "12"}, format="json"
    )

    response = client_as(stranger).get(LIST_URL, {"item": str(free_sale_item.id)})

    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_summary_aggregates_the_item_track_record(
    client_as, booker, stranger, free_sale_item
):
    expected_entries = 2
    # Distinct windows: confirmed bookings on one item may not overlap.
    start = timezone.now() - timedelta(days=10)
    for offset, (user, amount) in enumerate(((booker, "10"), (stranger, "20"))):
        booking = SettledBookingFactory(
            item=free_sale_item,
            user=user,
            time_from=start + timedelta(days=offset * 2),
            time_to=start + timedelta(days=offset * 2 + 1),
        )
        client_as(user).post(
            LIST_URL, {"booking": str(booking.id), "amount": amount}, format="json"
        )

    response = client_as(stranger).get(SUMMARY_URL, {"item": str(free_sale_item.id)})

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == expected_entries
    assert response.data["total"] == "30.00"
    assert response.data["average"] == "15.00"


def test_summary_of_an_unvalued_item_is_zero(client_as, stranger, free_sale_item):
    response = client_as(stranger).get(SUMMARY_URL, {"item": str(free_sale_item.id)})

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 0
    assert response.data["total"] == "0.00"
    assert response.data["average"] is None


# ---------------------------------------------------------------------------
# Remembered price
# ---------------------------------------------------------------------------


def test_suggestion_returns_the_value_this_user_picked_last(
    client_as, booker, rental_booking
):
    client_as(booker).post(
        LIST_URL, {"booking": str(rental_booking.id), "rate": "6"}, format="json"
    )

    response = client_as(booker).get(
        SUGGESTION_URL, {"item": str(rental_booking.item_id)}
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["has_previous"] is True
    assert response.data["rate"] == "6.00"
    assert response.data["rental_period"] == "d"


def test_suggestion_follows_a_correction_of_an_older_valuation(
    client_as, booker, free_sale_item
):
    """Correcting an earlier entry is the most recent act of picking a value."""
    client = client_as(booker)
    start = timezone.now() - timedelta(days=10)
    bookings = [
        SettledBookingFactory(
            item=free_sale_item,
            user=booker,
            time_from=start + timedelta(days=offset * 2),
            time_to=start + timedelta(days=offset * 2 + 1),
        )
        for offset in range(2)
    ]

    for booking, amount in zip(bookings, ("10", "20"), strict=True):
        client.post(
            LIST_URL, {"booking": str(booking.id), "amount": amount}, format="json"
        )
    # Go back and correct the *older* booking
    client.post(
        LIST_URL, {"booking": str(bookings[0].id), "amount": "30"}, format="json"
    )

    response = client.get(SUGGESTION_URL, {"item": str(free_sale_item.id)})

    assert response.status_code == status.HTTP_200_OK
    assert response.data["amount"] == "30.00"


def test_suggestion_is_per_user(client_as, booker, stranger, rental_booking):
    """One member's price is not proposed to the next."""
    client_as(booker).post(
        LIST_URL, {"booking": str(rental_booking.id), "rate": "6"}, format="json"
    )

    response = client_as(stranger).get(
        SUGGESTION_URL, {"item": str(rental_booking.item_id)}
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["has_previous"] is False
    assert response.data["rate"] is None
    # The item's own period is still reported so the slider can label itself
    assert response.data["rental_period"] == "d"


def test_suggestion_requires_authentication(client_as, free_sale_item):
    response = client_as().get(SUGGESTION_URL, {"item": str(free_sale_item.id)})

    assert response.status_code in (
        status.HTTP_401_UNAUTHORIZED,
        status.HTTP_403_FORBIDDEN,
    )


# ---------------------------------------------------------------------------
# Booking integration
# ---------------------------------------------------------------------------


def test_booking_detail_reports_eligibility_and_valuation(
    client_as, booker, sale_booking
):
    """The booking endpoint drives the prompt shown after a transaction."""
    client = client_as(booker)
    url = reverse("api:booking-detail", kwargs={"id": str(sale_booking.id)})

    before = client.get(url)
    assert before.status_code == status.HTTP_200_OK
    assert before.data["coin_valuation_eligible"] is True
    assert before.data["coin_valuation"] is None

    client.post(
        LIST_URL, {"booking": str(sale_booking.id), "amount": "4"}, format="json"
    )

    after = client.get(url)
    assert after.data["coin_valuation"]["amount"] == "4.00"


def test_booking_on_a_priced_item_is_not_eligible(client_as, booker):
    item = ItemFactory(sales_type=SalesType.SELL, price="10.00")
    booking = SettledBookingFactory(item=item, user=booker, time_to=None)

    response = client_as(booker).get(
        reverse("api:booking-detail", kwargs={"id": str(booking.id)})
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["coin_valuation_eligible"] is False
