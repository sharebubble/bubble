"""Tests for booking API endpoints and auto-confirmation logic."""

from datetime import timedelta

from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from bubble.bookings.models import Booking, BookingStatus
from bubble.bookings.tests.factories import (
    BookingFactory,
    ItemFactory,
    SelfServiceItemFactory,
)
from bubble.core.permissions_config import DefaultGroup
from bubble.items.models import ItemStatus, SalesType
from bubble.users.tests.factories import UserFactory


class BookingAutoConfirmTestCase(APITestCase):
    """
    Test auto-confirmation of bookings for self-service items.

    Auto-confirm only triggers when the offered price exactly matches the
    calculated rental_price (item.price * booking duration in hours).
    Items with no price (borrow/donate) auto-confirm when no offer is needed.
    """

    def setUp(self):
        """Set up test data."""
        self.client = APIClient()

        # Create default group
        self.default_group, _ = Group.objects.get_or_create(name=DefaultGroup.DEFAULT)

        # Create users
        self.item_owner = UserFactory()
        self.item_owner.groups.add(self.default_group)

        self.booking_user = UserFactory()
        self.booking_user.groups.add(self.default_group)

        # SelfServiceItemFactory defaults: sales_type=RENT, price=10.00/h
        # Booking duration: 24 h → rental_price = 10.00 * 24 = 240.00
        self.time_to = timezone.now() + timedelta(days=1)
        self.regular_item = ItemFactory(user=self.item_owner, rental_self_service=False)
        self.self_service_item = SelfServiceItemFactory(user=self.item_owner)

    def test_booking_regular_item_stays_pending(self):
        """
        Non-self-service item always stays PENDING regardless of offer matching
        rental_price.
        """
        self.client.force_authenticate(user=self.booking_user)

        # Offer matches rental_price (10.00/h * 24h = 240.00) but item is not
        # self-service, so the booking must remain PENDING.
        response = self.client.post(
            "/api/bookings/",
            {
                "item": str(self.regular_item.id),
                "offer": "240.00",
                "time_to": self.time_to,
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED, response.content
        assert response.data["status"] == BookingStatus.PENDING

        booking = Booking.objects.get(id=response.data["id"])
        assert booking.status == BookingStatus.PENDING

    def test_booking_self_service_item_auto_confirms_at_exact_price(self):
        """
        Self-service booking is auto-confirmed when offer == rental_price.
        rental_price = item.price (10.00/h) * 24 h = 240.00.
        """
        self.client.force_authenticate(user=self.booking_user)

        response = self.client.post(
            "/api/bookings/",
            {
                "item": str(self.self_service_item.id),
                "offer": "240.00",
                "time_to": self.time_to,
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["status"] == BookingStatus.CONFIRMED

        booking = Booking.objects.get(id=response.data["id"])
        assert booking.status == BookingStatus.CONFIRMED

    def test_booking_self_service_item_stays_pending_on_wrong_offer(self):
        """
        Self-service booking stays PENDING when offer does not match rental_price.
        """
        self.client.force_authenticate(user=self.booking_user)

        response = self.client.post(
            "/api/bookings/",
            {
                "item": str(self.self_service_item.id),
                "offer": "15.00",
                "time_to": self.time_to,
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["status"] == BookingStatus.PENDING

        booking = Booking.objects.get(id=response.data["id"])
        assert booking.status == BookingStatus.PENDING

    def test_self_service_booking_visible_in_public_endpoint(self):
        """Auto-confirmed booking (exact price) appears in the public endpoint."""
        self.client.force_authenticate(user=self.booking_user)

        response = self.client.post(
            "/api/bookings/",
            {
                "item": str(self.self_service_item.id),
                "offer": "240.00",
                "time_to": self.time_to,
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        booking_id = response.data["id"]

        response = self.client.get("/api/public-bookings/")
        assert response.status_code == status.HTTP_200_OK

        booking_ids = [b["id"] for b in response.data["results"]]
        assert booking_id in booking_ids

    def test_pending_booking_not_visible_in_public_endpoint(self):
        """PENDING bookings (wrong offer) do not appear in the public endpoint."""
        self.client.force_authenticate(user=self.booking_user)

        response = self.client.post(
            "/api/bookings/",
            {
                "item": str(self.regular_item.id),
                "offer": "240.00",
                "time_to": self.time_to,
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        booking_id = response.data["id"]
        assert response.data["status"] == BookingStatus.PENDING

        response = self.client.get("/api/public-bookings/")
        assert response.status_code == status.HTTP_200_OK

        booking_ids = [b["id"] for b in response.data["results"]]
        assert booking_id not in booking_ids

    def test_self_service_no_price_item_auto_confirms_without_offer(self):
        """
        A self-service item with no price (e.g. borrow) has rental_price == None.
        When no offer is submitted the booking should auto-confirm because
        offer (None) == rental_price (None).
        """
        borrow_item = SelfServiceItemFactory(
            user=self.item_owner,
            sales_type=SalesType.BORROW,
            price=None,
            rental_open_end=True,
        )
        self.client.force_authenticate(user=self.booking_user)

        response = self.client.post(
            "/api/bookings/",
            {"item": str(borrow_item.id)},
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["status"] == BookingStatus.CONFIRMED

    def test_booking_no_open_ended_without_time_to_fails(self):
        """Booking without time_to fails when open-ended is not allowed."""
        self.client.force_authenticate(user=self.booking_user)

        response = self.client.post(
            "/api/bookings/",
            {
                "item": str(self.regular_item.id),
                "offer": "240.00",
                # Intentionally not providing time_to
            },
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "time_to" in response.data
        assert "required" in response.data["time_to"][0].lower()


class PublicBookingViewSetTestCase(APITestCase):
    """Test PublicBookingViewSet functionality."""

    def setUp(self):
        """Set up test data."""
        self.client = APIClient()

        # Create default group
        self.default_group, _ = Group.objects.get_or_create(name=DefaultGroup.DEFAULT)

        # Create users
        self.user = UserFactory()
        self.user.groups.add(self.default_group)

        # Create item
        self.item = ItemFactory(user=self.user)

        # Create bookings with different statuses
        self.pending_booking = BookingFactory(
            user=self.user, item=self.item, status=BookingStatus.PENDING
        )
        self.confirmed_booking = BookingFactory(
            user=self.user, item=self.item, status=BookingStatus.CONFIRMED
        )
        self.cancelled_booking = BookingFactory(
            user=self.user, item=self.item, status=BookingStatus.CANCELLED
        )
        self.completed_booking = BookingFactory(
            user=self.user, item=self.item, status=BookingStatus.COMPLETED
        )

    def test_public_bookings_list_only_confirmed(self):
        """Test public bookings endpoint only returns CONFIRMED bookings."""
        response = self.client.get("/api/public-bookings/")

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data["results"]) == 1
        assert response.data["results"][0]["id"] == str(self.confirmed_booking.id)

    def test_public_bookings_detail_confirmed(self):
        """Test confirmed booking detail is accessible."""
        response = self.client.get(f"/api/public-bookings/{self.confirmed_booking.id}/")

        assert response.status_code == status.HTTP_200_OK
        assert response.data["id"] == str(self.confirmed_booking.id)
        assert response.data["status"] == BookingStatus.CONFIRMED

    def test_public_bookings_detail_pending_not_found(self):
        """Test pending booking not accessible via public endpoint."""
        response = self.client.get(f"/api/public-bookings/{self.pending_booking.id}/")

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_public_bookings_readonly(self):
        """Test public bookings endpoint is read-only."""
        self.client.force_authenticate(user=self.user)

        # Try to create
        response = self.client.post(
            "/api/public-bookings/",
            {"item": str(self.item.id), "offer": "10.00"},
            format="json",
        )
        assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED

        # Try to update
        response = self.client.patch(
            f"/api/public-bookings/{self.confirmed_booking.id}/",
            {"status": BookingStatus.CANCELLED},
            format="json",
        )
        assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED

        # Try to delete
        response = self.client.delete(
            f"/api/public-bookings/{self.confirmed_booking.id}/"
        )
        assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED

    def test_public_bookings_unauthenticated_access(self):
        """Test unauthenticated users can view public bookings."""
        # Don't authenticate
        response = self.client.get("/api/public-bookings/")

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data["results"]) == 1

    def test_public_bookings_filter_by_item(self):
        """Test filtering public bookings by item id."""
        # Create another item and confirmed booking
        item2 = ItemFactory(user=self.user)
        booking2 = BookingFactory(
            user=self.user, item=item2, status=BookingStatus.CONFIRMED
        )

        # Filter by first item
        response = self.client.get(f"/api/public-bookings/?item={self.item.id}")
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data["results"]) == 1
        assert response.data["results"][0]["id"] == str(self.confirmed_booking.id)

        # Filter by second item
        response = self.client.get(f"/api/public-bookings/?item={item2.id}")
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data["results"]) == 1
        assert response.data["results"][0]["id"] == str(booking2.id)


class BookingTimeToValidationTestCase(APITestCase):
    """Test validation for time_to field based on item's rental_open_end setting."""

    def setUp(self):
        """Set up test data."""
        self.client = APIClient()

        # Create default group
        self.default_group, _ = Group.objects.get_or_create(name=DefaultGroup.DEFAULT)

        # Create users
        self.item_owner = UserFactory()
        self.item_owner.groups.add(self.default_group)

        self.booking_user = UserFactory()
        self.booking_user.groups.add(self.default_group)

        # Create items with different rental_open_end settings
        self.item_requires_end_time = ItemFactory(
            user=self.item_owner,
            rental_self_service=True,
            rental_open_end=False,
            sales_type=SalesType.RENT,
            price="10.00",
        )
        self.item_allows_open_end = ItemFactory(
            user=self.item_owner,
            rental_self_service=True,
            rental_open_end=True,
            sales_type=SalesType.RENT,
            price="15.00",
        )

    def test_booking_without_time_to_fails_when_open_end_not_allowed(self):
        """Test booking without time_to fails when open-ended not allowed."""
        self.client.force_authenticate(user=self.booking_user)

        response = self.client.post(
            "/api/bookings/",
            {
                "item": str(self.item_requires_end_time.id),
                "offer": "20.00",
                # Intentionally not providing time_to
            },
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "time_to" in response.data
        assert "required" in response.data["time_to"][0].lower()

    def test_booking_without_time_to_succeeds_when_open_end_allowed(self):
        """Test booking without time_to succeeds when open-ended allowed."""
        self.client.force_authenticate(user=self.booking_user)

        response = self.client.post(
            "/api/bookings/",
            {
                "item": str(self.item_allows_open_end.id),
                "offer": "25.00",
                # Intentionally not providing time_to
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["time_to"] is None

        # Verify in database
        booking = Booking.objects.get(id=response.data["id"])
        assert booking.time_to is None

    def test_booking_with_time_to_succeeds_regardless_of_open_end_setting(self):
        """Test providing time_to succeeds regardless of rental_open_end."""
        self.client.force_authenticate(user=self.booking_user)
        future_time = (timezone.now() + timedelta(days=30)).isoformat()

        # Test with item that requires end time
        response = self.client.post(
            "/api/bookings/",
            {
                "item": str(self.item_requires_end_time.id),
                "offer": "20.00",
                "time_to": future_time,
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["time_to"] is not None

        # Test with item that allows open end (but we're still providing time_to)
        response = self.client.post(
            "/api/bookings/",
            {
                "item": str(self.item_allows_open_end.id),
                "offer": "25.00",
                "time_to": future_time,
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["time_to"] is not None

    def test_booking_sale_item_without_time_to_succeeds(self):
        """Sale-only items should be bookable without a time_to value."""
        self.client.force_authenticate(user=self.booking_user)

        # Create a sale-only item (no rental price)
        sale_item = ItemFactory(
            user=self.item_owner,
            sales_type=SalesType.SELL,
            price="100.00",
            rental_self_service=False,
        )

        response = self.client.post(
            "/api/bookings/",
            {
                "item": str(sale_item.id),
                "offer": "100.00",
                # No time_to provided
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["time_to"] is None

        # Verify in database
        booking = Booking.objects.get(id=response.data["id"])
        assert booking.time_to is None


class BookingSalesTypeTimeToValidationTestCase(APITestCase):
    """Test time_to validation across all sales types."""

    def setUp(self):
        """Set up test data."""
        self.client = APIClient()

        self.default_group, _ = Group.objects.get_or_create(name=DefaultGroup.DEFAULT)

        self.item_owner = UserFactory()
        self.item_owner.groups.add(self.default_group)

        self.booking_user = UserFactory()
        self.booking_user.groups.add(self.default_group)

    # --- Rental-like types: require time_to when rental_open_end=False ---

    def test_rent_without_time_to_fails(self):
        """RENT item with rental_open_end=False requires time_to."""
        self.client.force_authenticate(user=self.booking_user)
        item = ItemFactory(
            user=self.item_owner,
            sales_type=SalesType.RENT,
            price="10.00",
            rental_open_end=False,
        )

        response = self.client.post(
            "/api/bookings/",
            {"item": str(item.id), "offer": "10.00"},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "time_to" in response.data
        assert "required" in response.data["time_to"][0].lower()

    def test_borrow_without_time_to_fails(self):
        """BORROW item with rental_open_end=False requires time_to."""
        self.client.force_authenticate(user=self.booking_user)
        item = ItemFactory(
            user=self.item_owner,
            sales_type=SalesType.BORROW,
            price=None,
            rental_open_end=False,
        )

        response = self.client.post(
            "/api/bookings/",
            {"item": str(item.id), "offer": "0.00"},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "time_to" in response.data
        assert "required" in response.data["time_to"][0].lower()

    def test_want_rent_without_time_to_fails(self):
        """WANT_RENT item with rental_open_end=False requires time_to."""
        self.client.force_authenticate(user=self.booking_user)
        item = ItemFactory(
            user=self.item_owner,
            sales_type=SalesType.WANT_RENT,
            price=None,
            rental_open_end=False,
        )

        response = self.client.post(
            "/api/bookings/",
            {"item": str(item.id), "offer": "0.00"},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "time_to" in response.data
        assert "required" in response.data["time_to"][0].lower()

    # --- Sale-like types: time_to is never required ---

    def test_donate_without_time_to_succeeds(self):
        """DONATE item should be bookable without time_to."""
        self.client.force_authenticate(user=self.booking_user)
        item = ItemFactory(
            user=self.item_owner,
            sales_type=SalesType.DONATE,
            price=None,
            rental_open_end=False,
        )

        response = self.client.post(
            "/api/bookings/",
            {"item": str(item.id), "offer": "0.00"},
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["time_to"] is None

        booking = Booking.objects.get(id=response.data["id"])
        assert booking.time_to is None

    def test_want_buy_without_time_to_succeeds(self):
        """WANT_BUY item should be bookable without time_to."""
        self.client.force_authenticate(user=self.booking_user)
        item = ItemFactory(
            user=self.item_owner,
            sales_type=SalesType.WANT_BUY,
            price=None,
            rental_open_end=False,
        )

        response = self.client.post(
            "/api/bookings/",
            {"item": str(item.id), "offer": "0.00"},
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["time_to"] is None

        booking = Booking.objects.get(id=response.data["id"])
        assert booking.time_to is None


class BookingItemStatusSignalTestCase(APITestCase):
    """Test the update_item_status signal updates item status on booking changes."""

    def setUp(self):
        """Set up test data."""
        self.client = APIClient()

        self.default_group, _ = Group.objects.get_or_create(name=DefaultGroup.DEFAULT)

        self.item_owner = UserFactory()
        self.item_owner.groups.add(self.default_group)

        self.booking_user = UserFactory()
        self.booking_user.groups.add(self.default_group)

    # --- CONFIRMED + sale-like → SOLD ---

    def test_confirmed_sell_booking_sets_item_sold(self):
        """Confirming a SELL booking sets item status to SOLD."""
        item = ItemFactory(
            user=self.item_owner, sales_type=SalesType.SELL, price="50.00"
        )
        booking = BookingFactory(
            user=self.booking_user, item=item, status=BookingStatus.PENDING
        )

        booking.status = BookingStatus.CONFIRMED
        booking.save()

        item.refresh_from_db()
        assert item.status == ItemStatus.SOLD

    def test_confirmed_donate_booking_sets_item_sold(self):
        """Confirming a DONATE booking sets item status to SOLD."""
        item = ItemFactory(
            user=self.item_owner, sales_type=SalesType.DONATE, price=None
        )
        booking = BookingFactory(
            user=self.booking_user, item=item, status=BookingStatus.PENDING
        )

        booking.status = BookingStatus.CONFIRMED
        booking.save()

        item.refresh_from_db()
        assert item.status == ItemStatus.SOLD

    def test_confirmed_want_buy_booking_sets_item_sold(self):
        """Confirming a WANT_BUY booking sets item status to SOLD."""
        item = ItemFactory(
            user=self.item_owner, sales_type=SalesType.WANT_BUY, price=None
        )
        booking = BookingFactory(
            user=self.booking_user, item=item, status=BookingStatus.PENDING
        )

        booking.status = BookingStatus.CONFIRMED
        booking.save()

        item.refresh_from_db()
        assert item.status == ItemStatus.SOLD

    # --- CONFIRMED + rental-like + is_active=True → RENTED ---

    def test_confirmed_rent_booking_active_sets_item_rented(self):
        """Confirming an active RENT booking sets item status to RENTED."""
        item = ItemFactory(
            user=self.item_owner, sales_type=SalesType.RENT, price="10.00"
        )
        booking = BookingFactory(
            user=self.booking_user,
            item=item,
            status=BookingStatus.PENDING,
            time_from=timezone.now() - timedelta(hours=1),
            time_to=timezone.now() + timedelta(hours=1),
        )

        booking.status = BookingStatus.CONFIRMED
        booking.save()

        item.refresh_from_db()
        assert item.status == ItemStatus.RENTED

    def test_confirmed_borrow_booking_active_sets_item_rented(self):
        """Confirming an active BORROW booking sets item status to RENTED."""
        item = ItemFactory(
            user=self.item_owner, sales_type=SalesType.BORROW, price=None
        )
        booking = BookingFactory(
            user=self.booking_user,
            item=item,
            status=BookingStatus.PENDING,
            time_from=timezone.now() - timedelta(hours=1),
            time_to=timezone.now() + timedelta(hours=1),
        )

        booking.status = BookingStatus.CONFIRMED
        booking.save()

        item.refresh_from_db()
        assert item.status == ItemStatus.RENTED

    def test_confirmed_want_rent_booking_active_sets_item_rented(self):
        """Confirming an active WANT_RENT booking sets item status to RENTED."""
        item = ItemFactory(
            user=self.item_owner, sales_type=SalesType.WANT_RENT, price=None
        )
        booking = BookingFactory(
            user=self.booking_user,
            item=item,
            status=BookingStatus.PENDING,
            time_from=timezone.now() - timedelta(hours=1),
            time_to=timezone.now() + timedelta(hours=1),
        )

        booking.status = BookingStatus.CONFIRMED
        booking.save()

        item.refresh_from_db()
        assert item.status == ItemStatus.RENTED

    # --- CONFIRMED + rental-like + is_active=False → status unchanged ---

    def test_confirmed_rent_booking_inactive_does_not_change_item_status(self):
        """Confirming an inactive RENT booking (future) does not set item to RENTED."""
        item = ItemFactory(
            user=self.item_owner,
            sales_type=SalesType.RENT,
            price="10.00",
            status=ItemStatus.AVAILABLE,
        )
        booking = BookingFactory(
            user=self.booking_user,
            item=item,
            status=BookingStatus.PENDING,
            time_from=timezone.now() + timedelta(days=1),
            time_to=timezone.now() + timedelta(days=2),
        )

        booking.status = BookingStatus.CONFIRMED
        booking.save()

        item.refresh_from_db()
        assert item.status == ItemStatus.AVAILABLE

    # --- CANCELLED/REJECTED from SOLD/RENTED → AVAILABLE ---

    def test_cancelled_booking_resets_sold_item_to_available(self):
        """Cancelling a booking on a SOLD item resets it to AVAILABLE."""
        item = ItemFactory(
            user=self.item_owner,
            sales_type=SalesType.SELL,
            price="50.00",
            status=ItemStatus.SOLD,
        )
        booking = BookingFactory(
            user=self.booking_user,
            item=item,
            status=BookingStatus.CONFIRMED,
        )

        booking.status = BookingStatus.CANCELLED
        booking.save()

        item.refresh_from_db()
        assert item.status == ItemStatus.AVAILABLE

    def test_rejected_booking_resets_rented_item_to_available(self):
        """Rejecting a booking on a RENTED item resets it to AVAILABLE."""
        item = ItemFactory(
            user=self.item_owner,
            sales_type=SalesType.RENT,
            price="10.00",
            status=ItemStatus.RENTED,
        )
        booking = BookingFactory(
            user=self.booking_user,
            item=item,
            status=BookingStatus.CONFIRMED,
        )

        booking.status = BookingStatus.REJECTED
        booking.save()

        item.refresh_from_db()
        assert item.status == ItemStatus.AVAILABLE


class BookingAutoConfirmPriceCheckTestCase(APITestCase):
    """Auto-approval on self-service items must only trigger when the offered
    price exactly matches the calculated rental_price (item.price * hours)."""

    def setUp(self):
        self.client = APIClient()
        self.default_group, _ = Group.objects.get_or_create(name=DefaultGroup.DEFAULT)

        self.item_owner = UserFactory()
        self.item_owner.groups.add(self.default_group)

        self.booking_user = UserFactory()
        self.booking_user.groups.add(self.default_group)

        # Self-service item listed at €10.00/hour.
        # Booking duration: 24 h → rental_price = 10.00 * 24 = 240.00
        self.item = SelfServiceItemFactory(user=self.item_owner, price="10.00")

        self.time_to = timezone.now() + timedelta(days=1)

    def test_exact_price_auto_confirms(self):
        """
        Booking with offer == rental_price is auto-confirmed on a self-service item.
        rental_price = item.price (10.00/h) * 24 h = 240.00.
        """
        self.client.force_authenticate(user=self.booking_user)

        response = self.client.post(
            "/api/bookings/",
            {"item": str(self.item.id), "offer": "240.00", "time_to": self.time_to},
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["status"] == BookingStatus.CONFIRMED
        booking = Booking.objects.get(id=response.data["id"])
        assert booking.status == BookingStatus.CONFIRMED

    def test_lower_offer_stays_pending(self):
        """
        Booking with offer < rental_price stays PENDING
        even on a self-service item.
        """
        self.client.force_authenticate(user=self.booking_user)

        response = self.client.post(
            "/api/bookings/",
            {"item": str(self.item.id), "offer": "100.00", "time_to": self.time_to},
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["status"] == BookingStatus.PENDING
        booking = Booking.objects.get(id=response.data["id"])
        assert booking.status == BookingStatus.PENDING

    def test_higher_offer_stays_pending(self):
        """
        Booking with offer > rental_price stays PENDING
        even on a self-service item.
        """
        self.client.force_authenticate(user=self.booking_user)

        response = self.client.post(
            "/api/bookings/",
            {"item": str(self.item.id), "offer": "999.99", "time_to": self.time_to},
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["status"] == BookingStatus.CONFIRMED

    def test_non_self_service_exact_price_stays_pending(self):
        """
        Even an offer matching rental_price on a non-self-service
        item stays PENDING.
        """
        regular_item = ItemFactory(
            user=self.item_owner, rental_self_service=False, price="10.00"
        )
        self.client.force_authenticate(user=self.booking_user)

        response = self.client.post(
            "/api/bookings/",
            {"item": str(regular_item.id), "offer": "240.00", "time_to": self.time_to},
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["status"] == BookingStatus.PENDING

    def test_owner_booking_own_item_always_auto_confirms(self):
        """The item owner booking their own item is always auto-confirmed,
        regardless of the offered price."""
        self.client.force_authenticate(user=self.item_owner)

        response = self.client.post(
            "/api/bookings/",
            {"item": str(self.item.id), "offer": "1.00", "time_to": self.time_to},
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["status"] == BookingStatus.CONFIRMED
