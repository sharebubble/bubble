"""API tests for recorded payments.

Covers the flow behind the post-booking prompt: who may record what they
paid, how a free booking's voluntary amount is suggested, and how the
resulting history is exposed to everyone who can see the item.
"""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.contrib.auth.models import Group
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from bubble.bookings.models import BookingStatus
from bubble.core.permissions_config import DefaultGroup
from bubble.items.models import ItemStatus, VisibilityType
from bubble.ledger.models import Transaction, TransactionKind
from bubble.ledger.tests.factories import (
    CompletedBookingFactory,
    FreeRentalItemFactory,
    FreeSaleItemFactory,
    PricedItemFactory,
)
from bubble.users.tests.factories import UserFactory

LIST_URL = reverse("api:payment-list")
SUMMARY_URL = reverse("api:payment-summary")
SUGGESTION_URL = reverse("api:payment-suggestion")
BALANCE_URL = reverse("api:payment-balance")


@pytest.fixture
def booker(db):
    user = UserFactory()
    group, _ = Group.objects.get_or_create(name=DefaultGroup.DEFAULT)
    user.groups.add(group)
    return user


@pytest.fixture
def stranger(db):
    return UserFactory()


@pytest.fixture
def free_item(db):
    return FreeSaleItemFactory()


@pytest.fixture
def free_booking(free_item, booker):
    return CompletedBookingFactory(item=free_item, user=booker)


@pytest.fixture
def client_as(db):
    def _client(user=None):
        client = APIClient()
        if user is not None:
            client.force_authenticate(user)
        return client

    return _client


# ---------------------------------------------------------------------------
# Recording a payment
# ---------------------------------------------------------------------------


def test_booker_can_record_a_voluntary_payment(client_as, booker, free_booking):
    response = client_as(booker).post(
        LIST_URL, {"booking": str(free_booking.id), "amount": "12.50"}, format="json"
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["amount"] == "12.50"
    assert response.data["voluntary"] is True


def test_a_priced_booking_is_settled_not_voluntary(client_as, booker):
    booking = CompletedBookingFactory(item=PricedItemFactory(), user=booker)

    response = client_as(booker).post(
        LIST_URL, {"booking": str(booking.id), "amount": "20.00"}, format="json"
    )

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["voluntary"] is False


def test_a_booking_still_in_progress_cannot_be_paid(client_as, booker, free_item):
    """The prompt only comes after the booking has completed."""
    booking = CompletedBookingFactory(
        item=free_item, user=booker, status=BookingStatus.IN_PROGRESS
    )

    response = client_as(booker).post(
        LIST_URL, {"booking": str(booking.id), "amount": "5"}, format="json"
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST


def test_only_the_booker_may_record_the_payment(client_as, stranger, free_booking):
    response = client_as(stranger).post(
        LIST_URL, {"booking": str(free_booking.id), "amount": "5"}, format="json"
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert not Transaction.objects.exists()


def test_paying_for_your_own_item_is_refused(client_as, booker):
    """Both legs would be the same account, so nothing would actually move."""
    booking = CompletedBookingFactory(
        item=FreeSaleItemFactory(user=booker), user=booker
    )

    response = client_as(booker).post(
        LIST_URL, {"booking": str(booking.id), "amount": "5"}, format="json"
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    # Refused by a validator, so the message names the reason rather than
    # falling through to the ledger's generic refusal.
    assert "own item" in str(response.data)
    assert not Transaction.objects.exists()


def test_anonymous_users_cannot_record_payments(client_as, free_booking):
    response = client_as().post(
        LIST_URL, {"booking": str(free_booking.id), "amount": "5"}, format="json"
    )

    assert response.status_code in (
        status.HTTP_401_UNAUTHORIZED,
        status.HTTP_403_FORBIDDEN,
    )


def test_recording_again_replaces_the_standing_figure(client_as, booker, free_booking):
    client = client_as(booker)
    client.post(
        LIST_URL, {"booking": str(free_booking.id), "amount": "5"}, format="json"
    )
    response = client.post(
        LIST_URL, {"booking": str(free_booking.id), "amount": "8"}, format="json"
    )

    assert response.status_code == status.HTTP_201_CREATED
    standing = Transaction.objects.filter(
        kind=TransactionKind.BOOKING_PAYMENT, reversed_by__isnull=True
    )
    assert standing.count() == 1


# ---------------------------------------------------------------------------
# Item payment history
# ---------------------------------------------------------------------------


def test_payment_history_is_visible_to_other_members(
    client_as, booker, stranger, free_booking
):
    client_as(booker).post(
        LIST_URL, {"booking": str(free_booking.id), "amount": "12"}, format="json"
    )

    response = client_as(stranger).get(LIST_URL, {"item": str(free_booking.item_id)})

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 1
    entry = response.data["results"][0]
    assert entry["amount"] == "12.00"
    assert entry["payer"]["username"] == booker.username
    # As public as the item — it must not leak contact data.
    assert "email" not in entry["payer"]


def test_a_corrected_payment_shows_once_in_history(client_as, booker, free_booking):
    client = client_as(booker)
    client.post(
        LIST_URL, {"booking": str(free_booking.id), "amount": "5"}, format="json"
    )
    client.post(
        LIST_URL, {"booking": str(free_booking.id), "amount": "8"}, format="json"
    )

    response = client.get(LIST_URL, {"item": str(free_booking.item_id)})

    assert response.data["count"] == 1
    assert response.data["results"][0]["amount"] == "8.00"


def test_payment_history_requires_an_item(client_as, stranger):
    response = client_as(stranger).get(LIST_URL)

    assert response.status_code == status.HTTP_400_BAD_REQUEST


def test_payment_history_of_an_invisible_item_is_not_exposed(
    client_as, stranger, booker, free_item, free_booking
):
    free_item.visibility = VisibilityType.PRIVATE
    free_item.save(update_fields=["visibility"])
    client_as(booker).post(
        LIST_URL, {"booking": str(free_booking.id), "amount": "12"}, format="json"
    )

    response = client_as(stranger).get(LIST_URL, {"item": str(free_item.id)})

    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_payment_history_survives_the_item_being_sold(
    client_as, booker, stranger, free_item, free_booking
):
    """Being sold on is when an item's record matters most."""
    client_as(booker).post(
        LIST_URL, {"booking": str(free_booking.id), "amount": "12"}, format="json"
    )
    free_item.status = ItemStatus.SOLD
    free_item.save(update_fields=["status"])

    response = client_as(stranger).get(LIST_URL, {"item": str(free_item.id)})

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 1


def test_summary_aggregates_an_items_payments(client_as, booker, stranger, free_item):
    start = timezone.now() - timedelta(days=10)
    for offset, (user, amount) in enumerate(((booker, "10"), (stranger, "20"))):
        booking = CompletedBookingFactory(
            item=free_item,
            user=user,
            time_from=start + timedelta(days=offset * 2),
            time_to=start + timedelta(days=offset * 2 + 1),
        )
        client_as(user).post(
            LIST_URL, {"booking": str(booking.id), "amount": amount}, format="json"
        )

    response = client_as(stranger).get(SUMMARY_URL, {"item": str(free_item.id)})

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 2  # noqa: PLR2004
    assert response.data["total"] == "30.00"
    assert response.data["average"] == "15.00"


def test_summary_of_an_unpaid_item_is_zero(client_as, stranger, free_item):
    response = client_as(stranger).get(SUMMARY_URL, {"item": str(free_item.id)})

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 0
    assert response.data["total"] == "0.00"
    assert response.data["average"] is None


# ---------------------------------------------------------------------------
# Suggestion
# ---------------------------------------------------------------------------


def test_a_priced_booking_suggests_the_agreed_amount(client_as, booker):
    booking = CompletedBookingFactory(item=PricedItemFactory(), user=booker)

    response = client_as(booker).get(SUGGESTION_URL, {"booking": str(booking.id)})

    assert response.status_code == status.HTTP_200_OK
    assert response.data["agreed"] is True
    assert Decimal(response.data["amount"]) == Decimal("20.00")


def test_a_free_booking_suggests_what_this_member_paid_before(
    client_as, booker, free_item
):
    start = timezone.now() - timedelta(days=10)
    first = CompletedBookingFactory(
        item=free_item, user=booker, time_from=start, time_to=start + timedelta(days=1)
    )
    client_as(booker).post(
        LIST_URL, {"booking": str(first.id), "amount": "6"}, format="json"
    )
    second = CompletedBookingFactory(
        item=free_item,
        user=booker,
        time_from=start + timedelta(days=4),
        time_to=start + timedelta(days=5),
    )

    response = client_as(booker).get(SUGGESTION_URL, {"booking": str(second.id)})

    assert response.status_code == status.HTTP_200_OK
    assert response.data["agreed"] is False
    assert response.data["from_previous"] is True
    assert Decimal(response.data["amount"]) == Decimal("6.00")


def test_a_first_free_booking_has_nothing_to_suggest(client_as, booker, free_booking):
    response = client_as(booker).get(SUGGESTION_URL, {"booking": str(free_booking.id)})

    assert response.status_code == status.HTTP_200_OK
    assert response.data["amount"] is None
    assert response.data["from_previous"] is False


def test_suggestion_is_per_member(client_as, booker, stranger, free_item):
    """One member's amount is not proposed to the next."""
    start = timezone.now() - timedelta(days=10)
    theirs = CompletedBookingFactory(
        item=free_item, user=booker, time_from=start, time_to=start + timedelta(days=1)
    )
    client_as(booker).post(
        LIST_URL, {"booking": str(theirs.id), "amount": "6"}, format="json"
    )
    mine = CompletedBookingFactory(
        item=free_item,
        user=stranger,
        time_from=start + timedelta(days=4),
        time_to=start + timedelta(days=5),
    )

    response = client_as(stranger).get(SUGGESTION_URL, {"booking": str(mine.id)})

    assert response.data["amount"] is None


def test_suggestion_is_only_for_your_own_booking(client_as, stranger, free_booking):
    response = client_as(stranger).get(
        SUGGESTION_URL, {"booking": str(free_booking.id)}
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND


# ---------------------------------------------------------------------------
# Balance
# ---------------------------------------------------------------------------


def test_balance_reflects_what_was_paid_and_received(client_as, booker, free_booking):
    owner = free_booking.item.user
    client_as(booker).post(
        LIST_URL, {"booking": str(free_booking.id), "amount": "12"}, format="json"
    )

    payer_view = client_as(booker).get(BALANCE_URL)
    assert payer_view.data["balance"] == "-12.00"
    assert payer_view.data["paid_out"] == "12.00"

    payee_view = client_as(owner).get(BALANCE_URL)
    assert payee_view.data["balance"] == "12.00"
    assert payee_view.data["received"] == "12.00"


def test_a_member_with_no_activity_has_a_zero_balance(client_as, stranger):
    response = client_as(stranger).get(BALANCE_URL)

    assert response.status_code == status.HTTP_200_OK
    assert response.data["balance"] == "0.00"


# ---------------------------------------------------------------------------
# Booking integration
# ---------------------------------------------------------------------------


def test_booking_detail_reports_the_payment_and_whether_one_is_due(
    client_as, booker, free_booking
):
    client = client_as(booker)
    url = reverse("api:booking-detail", kwargs={"id": str(free_booking.id)})

    before = client.get(url)
    assert before.status_code == status.HTTP_200_OK
    assert before.data["payment_recordable"] is True
    assert before.data["payment"] is None

    client.post(
        LIST_URL, {"booking": str(free_booking.id), "amount": "4"}, format="json"
    )

    after = client.get(url)
    assert after.data["payment"]["amount"] == "4.00"


def test_an_unfinished_booking_is_not_yet_recordable(client_as, booker):
    booking = CompletedBookingFactory(
        item=FreeRentalItemFactory(),
        user=booker,
        status=BookingStatus.CONFIRMED,
    )

    response = client_as(booker).get(
        reverse("api:booking-detail", kwargs={"id": str(booking.id)})
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["payment_recordable"] is False
