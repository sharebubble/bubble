"""Tests for an item's optional minimum rental duration (e.g. a guest room that
can only be booked for at least one day)."""

# mypy: ignore-errors

from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone, translation
from rest_framework import status
from rest_framework.test import APIClient

from bubble.bookings.models import Booking, BookingStatus
from bubble.bookings.tests.factories import SelfServiceItemFactory
from bubble.items.models import SalesType, format_hours
from bubble.items.tests.factories import ItemOwnerUserFactory as UserFactory

DAY = 24


@pytest.fixture
def owner(db):
    return UserFactory()


@pytest.fixture
def renter(db):
    return UserFactory()


@pytest.fixture
def guest_room(owner):
    return SelfServiceItemFactory(
        user=owner, name="Guest room", rental_period="d", rental_min_hours=DAY
    )


def book(user, item, hours, *, start=None):
    client = APIClient()
    client.force_authenticate(user=user)
    start = start or timezone.now() + timedelta(days=2)
    return client.post(
        reverse("api:booking-list"),
        {
            "item": str(item.id),
            "time_from": start.isoformat(),
            "time_to": (start + timedelta(hours=hours)).isoformat(),
            "offer": "10.00",
        },
        format="json",
        HTTP_ACCEPT_LANGUAGE="en",
    )


class TestBookingTheMinimum:
    def test_shorter_than_the_minimum_is_refused(self, renter, guest_room):
        response = book(renter, guest_room, hours=5)

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["time_to"] == [
            "This item can only be booked for at least 1 day."
        ]
        assert not Booking.objects.filter(item=guest_room).exists()

    def test_exactly_the_minimum_is_allowed(self, renter, guest_room):
        response = book(renter, guest_room, hours=DAY)
        assert response.status_code == status.HTTP_201_CREATED, response.data

    def test_longer_is_allowed(self, renter, guest_room):
        response = book(renter, guest_room, hours=3 * DAY)
        assert response.status_code == status.HTTP_201_CREATED, response.data

    def test_without_a_minimum_any_length_is_allowed(self, owner, renter):
        item = SelfServiceItemFactory(user=owner)
        response = book(renter, item, hours=1)
        assert response.status_code == status.HTTP_201_CREATED, response.data

    def test_sale_items_ignore_a_leftover_minimum(self, owner, renter):
        item = SelfServiceItemFactory(
            user=owner, sales_type=SalesType.SELL, price="20.00", rental_min_hours=DAY
        )
        response = book(renter, item, hours=1)
        assert response.status_code == status.HTTP_201_CREATED, response.data


class TestChangingTimes:
    def booking(self, item, user, hours):
        start = timezone.now() + timedelta(days=2)
        return Booking.objects.create(
            item=item,
            user=user,
            status=BookingStatus.PENDING,
            time_from=start,
            time_to=start + timedelta(hours=hours),
        )

    def patch(self, user, booking, data):
        client = APIClient()
        client.force_authenticate(user=user)
        return client.patch(
            reverse("api:booking-detail", kwargs={"id": booking.id}),
            data,
            format="json",
        )

    def test_shortening_below_the_minimum_is_refused(self, renter, guest_room):
        booking = self.booking(guest_room, renter, hours=2 * DAY)
        response = self.patch(
            renter,
            booking,
            {"time_to": (booking.time_from + timedelta(hours=3)).isoformat()},
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "time_to" in response.data

    def test_other_changes_skip_the_check(self, owner, renter, guest_room):
        # Booked before the owner raised the minimum: still answerable.
        booking = self.booking(guest_room, renter, hours=3)
        response = self.patch(owner, booking, {"counter_offer": "8.00"})
        assert response.status_code == status.HTTP_200_OK, response.data


class TestOpenEndedRentals:
    def test_a_booking_without_an_end_is_not_checked(self, owner, renter):
        item = SelfServiceItemFactory(
            user=owner, rental_open_end=True, rental_min_hours=DAY
        )
        client = APIClient()
        client.force_authenticate(user=renter)
        response = client.post(
            reverse("api:booking-list"),
            {
                "item": str(item.id),
                "time_from": (timezone.now() + timedelta(days=1)).isoformat(),
                "time_to": None,
                "offer": "10.00",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.data


class TestTheItem:
    def test_owner_sets_it_through_the_item_api(self, owner):
        item = SelfServiceItemFactory(user=owner)
        client = APIClient()
        client.force_authenticate(user=owner)
        url = reverse("api:item-detail", kwargs={"id": item.id})
        response = client.patch(url, {"rental_min_hours": 48}, format="json")
        assert response.status_code == status.HTTP_200_OK, response.data
        assert response.data["rental_min_hours"] == 48  # noqa: PLR2004

        cleared = client.patch(url, {"rental_min_hours": None}, format="json")
        assert cleared.data["rental_min_hours"] is None

    def test_zero_is_not_a_minimum(self, owner):
        item = SelfServiceItemFactory(user=owner)
        client = APIClient()
        client.force_authenticate(user=owner)
        response = client.patch(
            reverse("api:item-detail", kwargs={"id": item.id}),
            {"rental_min_hours": 0},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.parametrize(
        ("hours", "text"),
        [
            (1, "1 hour"),
            (5, "5 hours"),
            (24, "1 day"),
            (36, "36 hours"),
            (72, "3 days"),
            (168, "1 week"),
            (336, "2 weeks"),
        ],
    )
    def test_durations_read_naturally(self, hours, text):
        with translation.override("en"):
            assert format_hours(hours) == text
