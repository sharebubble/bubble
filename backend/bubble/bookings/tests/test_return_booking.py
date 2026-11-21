"""Tests for returning the item of a running open-ended rental."""

# mypy: ignore-errors

from datetime import timedelta

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from bubble.bookings.models import Booking, BookingStatus, Message
from bubble.bookings.tests.factories import SelfServiceItemFactory
from bubble.items.models import ItemStatus
from bubble.items.tests.factories import ItemOwnerUserFactory as UserFactory


class ReturnBookingTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = UserFactory()
        self.renter = UserFactory()
        self.item = SelfServiceItemFactory(user=self.owner, rental_open_end=True)
        self.booking = Booking.objects.create(
            item=self.item,
            user=self.renter,
            status=BookingStatus.CONFIRMED,
            time_from=timezone.now() - timedelta(hours=2),
            time_to=None,
        )
        self.item.refresh_from_db()

    def return_as(self, user, booking=None):
        self.client.force_authenticate(user=user)
        url = reverse(
            "api:booking-return-item", kwargs={"id": (booking or self.booking).id}
        )
        return self.client.post(url)

    def test_renter_returns_item(self):
        self.assertEqual(self.item.status, ItemStatus.RENTED)

        response = self.return_as(self.renter)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, BookingStatus.COMPLETED)
        self.assertIsNotNone(self.booking.time_to)
        self.assertLessEqual(self.booking.time_to, timezone.now())
        self.item.refresh_from_db()
        self.assertEqual(self.item.status, ItemStatus.AVAILABLE)
        self.assertTrue(
            Message.objects.filter(booking=self.booking, sender=self.renter).exists()
        )

    def test_owner_returns_item(self):
        response = self.return_as(self.owner)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, BookingStatus.COMPLETED)

    def test_other_user_cannot_return(self):
        response = self.return_as(UserFactory())

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, BookingStatus.CONFIRMED)

    def test_booking_with_end_date_cannot_be_returned(self):
        now = timezone.now()
        booking = Booking.objects.create(
            item=SelfServiceItemFactory(user=self.owner),
            user=self.renter,
            status=BookingStatus.CONFIRMED,
            time_from=now - timedelta(hours=1),
            time_to=now + timedelta(hours=1),
        )

        response = self.return_as(self.renter, booking)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_pending_booking_cannot_be_returned(self):
        self.booking.status = BookingStatus.PENDING
        self.booking.save()

        response = self.return_as(self.renter)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_running_open_ended_rental_cannot_be_cancelled(self):
        self.client.force_authenticate(user=self.renter)
        url = reverse("api:booking-detail", kwargs={"id": self.booking.id})

        response = self.client.patch(
            url, {"status": BookingStatus.CANCELLED}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, BookingStatus.CONFIRMED)

    def test_upcoming_open_ended_rental_can_still_be_cancelled(self):
        self.booking.time_from = timezone.now() + timedelta(days=1)
        self.booking.save()
        self.client.force_authenticate(user=self.renter)
        url = reverse("api:booking-detail", kwargs={"id": self.booking.id})

        response = self.client.patch(
            url, {"status": BookingStatus.CANCELLED}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
