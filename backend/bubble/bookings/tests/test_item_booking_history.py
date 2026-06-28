"""Tests for the per-item booking-history endpoint."""

# mypy: ignore-errors

from datetime import timedelta
from decimal import Decimal

from constance import config
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from bubble.bookings.models import Booking, BookingStatus
from bubble.items.models import Item, ItemStatus, SalesType, VisibilityType
from bubble.items.tests.factories import ItemOwnerUserFactory

TEST_PASSWORD = "testpass123"  # noqa: S105


class ItemBookingHistoryTestCase(TestCase):
    """Booking history is item-scoped, message-free, and name-gated."""

    def setUp(self):
        self.client = APIClient()
        self.owner = ItemOwnerUserFactory(username="owner", password=TEST_PASSWORD)
        self.renter = ItemOwnerUserFactory(username="renter", password=TEST_PASSWORD)
        self.viewer = ItemOwnerUserFactory(username="viewer", password=TEST_PASSWORD)

        self.item = Item.objects.create(
            name="Drill",
            user=self.owner,
            sales_type=SalesType.RENT,
            price=Decimal("5.00"),
            status=ItemStatus.AVAILABLE,
            visibility=VisibilityType.PUBLIC,
        )

        now = timezone.now()
        # Confirmed rental, 3 hours → rental total 15.00 (5/hr * 3h).
        self.confirmed = Booking.objects.create(
            item=self.item,
            user=self.renter,
            status=BookingStatus.CONFIRMED,
            time_from=now - timedelta(days=2),
            time_to=now - timedelta(days=2) + timedelta(hours=3),
        )
        # Completed rental with a negotiated offer of 12.00.
        self.completed = Booking.objects.create(
            item=self.item,
            user=self.renter,
            status=BookingStatus.COMPLETED,
            time_from=now - timedelta(days=5),
            time_to=now - timedelta(days=5) + timedelta(hours=2),
            offer=Decimal("12.00"),
        )
        # Pending must NOT appear in history.
        Booking.objects.create(
            item=self.item,
            user=self.renter,
            status=BookingStatus.PENDING,
            time_from=now,
            time_to=now + timedelta(hours=1),
        )

        self.url = reverse(
            "api:public-item-booking-history", kwargs={"id": self.item.id}
        )

    def test_authenticated_viewer_sees_confirmed_and_completed_only(self):
        self.client.force_authenticate(user=self.viewer)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 2)
        statuses = {row["status"] for row in response.data}
        self.assertEqual(
            statuses, {BookingStatus.CONFIRMED, BookingStatus.COMPLETED}
        )

    def test_prices_and_booker_for_authenticated_viewer(self):
        self.client.force_authenticate(user=self.viewer)
        response = self.client.get(self.url)
        by_status = {row["status"]: row for row in response.data}

        confirmed = by_status[BookingStatus.CONFIRMED]
        self.assertEqual(Decimal(confirmed["official_price"]), Decimal("5.00"))
        # No offer/counter → falls back to computed rental total (5/hr * 3h).
        self.assertEqual(Decimal(confirmed["amount_paid"]), Decimal("15.00"))
        self.assertEqual(Decimal(confirmed["rental_price"]), Decimal("15.00"))
        self.assertEqual(confirmed["booker"], self.renter.name)

        completed = by_status[BookingStatus.COMPLETED]
        # An explicit offer takes precedence as the amount paid.
        self.assertEqual(Decimal(completed["amount_paid"]), Decimal("12.00"))

    def test_history_never_exposes_messages(self):
        self.client.force_authenticate(user=self.viewer)
        response = self.client.get(self.url)
        for row in response.data:
            self.assertNotIn("messages", row)
            self.assertNotIn("unread_messages_count", row)
            self.assertNotIn("message", row)

    def test_booker_hidden_for_anonymous_viewer(self):
        # Allow anonymous access to the public item for this test.
        original = config.REQUIRE_LOGIN
        config.REQUIRE_LOGIN = False
        try:
            response = self.client.get(self.url)
        finally:
            config.REQUIRE_LOGIN = original

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 2)
        for row in response.data:
            # Bookings (dates/prices) are visible, but the booker name is not.
            self.assertIsNone(row["booker"])
            self.assertIsNotNone(row["time_from"])
            self.assertEqual(Decimal(row["official_price"]), Decimal("5.00"))
