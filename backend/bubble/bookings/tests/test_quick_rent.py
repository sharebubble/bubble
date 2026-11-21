"""Tests for QR-code quick rental (scan to rent, scan again to return)."""

# mypy: ignore-errors

from datetime import timedelta
from unittest import mock

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone, translation
from rest_framework import status
from rest_framework.test import APIClient

from bubble.bookings.models import Booking, BookingStatus, Message
from bubble.bookings.tests.factories import ItemFactory, SelfServiceItemFactory
from bubble.items.models import ItemStatus, SalesType, VisibilityType
from bubble.items.qr_pdf import quick_rent_url
from bubble.users.tests.factories import UserFactory


class QuickRentItemFactory(SelfServiceItemFactory):
    """Self-service rental that allows open-ended rentals: QR-code ready."""

    rental_open_end = True


class QuickRentTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = UserFactory(name="Owner")
        self.renter = UserFactory(name="Renter")
        self.other = UserFactory(name="Other")
        self.item = QuickRentItemFactory(
            user=self.owner, visibility=VisibilityType.AUTHENTICATED
        )

    def scan(self, user, item=None):
        self.client.force_authenticate(user=user)
        url = reverse(
            "api:public-item-quick-rent", kwargs={"id": (item or self.item).id}
        )
        return self.client.post(url)

    def test_first_scan_rents_item(self):
        response = self.scan(self.renter)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["result"], "rented")
        self.assertEqual(response.data["renter_name"], "Renter")
        booking = Booking.objects.get(id=response.data["booking_id"])
        self.assertEqual(booking.user, self.renter)
        self.assertEqual(booking.status, BookingStatus.CONFIRMED)
        self.assertIsNone(booking.time_to)
        self.item.refresh_from_db()
        self.assertEqual(self.item.status, ItemStatus.RENTED)
        self.assertTrue(
            Message.objects.filter(booking=booking, sender=self.renter).exists()
        )

    def test_second_scan_by_same_user_returns_item(self):
        rented = self.scan(self.renter)
        response = self.scan(self.renter)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["result"], "returned")
        self.assertEqual(response.data["booking_id"], rented.data["booking_id"])
        booking = Booking.objects.get(id=rented.data["booking_id"])
        self.assertEqual(booking.status, BookingStatus.COMPLETED)
        self.assertIsNotNone(booking.time_to)
        self.item.refresh_from_db()
        self.assertEqual(self.item.status, ItemStatus.AVAILABLE)

    def test_scan_by_other_user_shows_current_renter(self):
        rented = self.scan(self.renter)
        response = self.scan(self.other)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["result"], "unavailable")
        self.assertEqual(response.data["renter_name"], "Renter")
        self.assertEqual(str(response.data["renter_id"]), str(self.renter.id))
        self.assertEqual(Booking.objects.filter(item=self.item).count(), 1)
        booking = Booking.objects.get(id=rented.data["booking_id"])
        self.assertEqual(booking.status, BookingStatus.CONFIRMED)

    def test_item_can_be_rented_again_after_return(self):
        self.scan(self.renter)
        self.scan(self.renter)
        response = self.scan(self.other)

        self.assertEqual(response.data["result"], "rented")
        self.assertEqual(response.data["renter_name"], "Other")

    def test_scan_returns_calendar_booking_of_same_user(self):
        now = timezone.now()
        booking = Booking.objects.create(
            item=self.item,
            user=self.renter,
            status=BookingStatus.CONFIRMED,
            time_from=now - timedelta(hours=1),
            time_to=now + timedelta(hours=2),
        )

        response = self.scan(self.renter)

        self.assertEqual(response.data["result"], "returned")
        booking.refresh_from_db()
        self.assertEqual(booking.status, BookingStatus.COMPLETED)
        self.assertLess(booking.time_to, now + timedelta(hours=2))

    def test_rent_reports_next_booking(self):
        start = timezone.now() + timedelta(hours=3)
        Booking.objects.create(
            item=self.item,
            user=self.other,
            status=BookingStatus.CONFIRMED,
            time_from=start,
            time_to=start + timedelta(hours=1),
        )

        response = self.scan(self.renter)

        self.assertEqual(response.data["result"], "rented")
        self.assertIsNotNone(response.data["next_booking_at"])

    def test_requires_self_service(self):
        item = ItemFactory(
            user=self.owner, rental_self_service=False, rental_open_end=True
        )
        response = self.scan(self.renter, item)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Booking.objects.filter(item=item).exists())

    def test_requires_open_end(self):
        item = QuickRentItemFactory(user=self.owner, rental_open_end=False)
        response = self.scan(self.renter, item)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Booking.objects.filter(item=item).exists())

    def test_requires_rental_item(self):
        item = QuickRentItemFactory(user=self.owner, sales_type=SalesType.SELL)
        response = self.scan(self.renter, item)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_requires_authentication(self):
        url = reverse("api:public-item-quick-rent", kwargs={"id": self.item.id})
        response = self.client.post(url)

        self.assertIn(
            response.status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )

    def test_private_item_is_not_found(self):
        self.item.visibility = VisibilityType.PRIVATE
        self.item.save()

        response = self.scan(self.renter)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class QuickRentPdfTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = UserFactory()
        self.item = QuickRentItemFactory(user=self.owner, name="Cargo bike")

    def get_pdf(self, user, item=None):
        self.client.force_authenticate(user=user)
        url = reverse("api:item-quick-rent-pdf", kwargs={"id": (item or self.item).id})
        return self.client.get(url)

    def test_owner_downloads_pdf(self):
        response = self.get_pdf(self.owner)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertIn("attachment", response["Content-Disposition"])
        self.assertTrue(response.content.startswith(b"%PDF"))

    def test_non_owner_cannot_download_pdf(self):
        response = self.get_pdf(UserFactory())

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_pdf_requires_self_service(self):
        item = ItemFactory(
            user=self.owner, rental_self_service=False, rental_open_end=True
        )
        response = self.get_pdf(self.owner, item)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_pdf_requires_open_end(self):
        item = QuickRentItemFactory(user=self.owner, rental_open_end=False)
        response = self.get_pdf(self.owner, item)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_pdf_uses_request_language(self):
        self.client.force_authenticate(user=self.owner)
        url = reverse("api:item-quick-rent-pdf", kwargs={"id": self.item.id})
        languages = []

        def fake_render(item):
            languages.append(translation.get_language())
            return b"%PDF-fake"

        with mock.patch("bubble.items.api.views.render_quick_rent_pdf", fake_render):
            self.client.get(url, headers={"accept-language": "de"})
            self.client.get(url, headers={"accept-language": "en"})

        self.assertEqual(languages, ["de", "en"])

    def test_quick_rent_url_points_to_frontend(self):
        self.assertTrue(
            quick_rent_url(self.item).endswith(f"/item/{self.item.id}/quick-rent")
        )
