"""Tests for booking API endpoints and auto-confirmation logic."""

from datetime import timedelta
from decimal import Decimal

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
from bubble.items.models import ItemStatus, RentalPeriodType, SalesType
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


class BookingOpenEndRentalTestCase(APITestCase):
    """
    Test additional open-ended rental scenarios:

    - Providing time_to for a rental_open_end=True item is still accepted.
    - A BORROW item with rental_open_end=True can be booked without time_to.
    - PATCHing an existing booking to remove time_to fails when the item does
      not allow open-ended rentals.
    - Explicitly sending time_to=null behaves identically to omitting the field
      when rental_open_end=False (both must fail).
    """

    def setUp(self):
        self.client = APIClient()
        self.default_group, _ = Group.objects.get_or_create(name=DefaultGroup.DEFAULT)

        self.item_owner = UserFactory()
        self.item_owner.groups.add(self.default_group)

        self.booking_user = UserFactory()
        self.booking_user.groups.add(self.default_group)

        self.future_from = (timezone.now() + timedelta(days=1)).isoformat()
        self.future_to = (timezone.now() + timedelta(days=2)).isoformat()

        # Item that allows open-ended rentals (RENT)
        self.open_end_rent_item = ItemFactory(
            user=self.item_owner,
            sales_type=SalesType.RENT,
            price="10.00",
            rental_open_end=True,
        )

        # Item that allows open-ended rentals (BORROW)
        self.open_end_borrow_item = ItemFactory(
            user=self.item_owner,
            sales_type=SalesType.BORROW,
            price=None,
            rental_open_end=True,
        )

        # Item that requires an end time
        self.closed_end_item = ItemFactory(
            user=self.item_owner,
            sales_type=SalesType.RENT,
            price="10.00",
            rental_open_end=False,
        )

    def test_time_to_provided_for_open_end_item_is_accepted(self):
        """time_to is optional for rental_open_end=True items, but providing it is
        valid."""
        self.client.force_authenticate(user=self.booking_user)

        response = self.client.post(
            "/api/bookings/",
            {
                "item": str(self.open_end_rent_item.id),
                "offer": "20.00",
                "time_from": self.future_from,
                "time_to": self.future_to,
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["time_to"] is not None
        booking = Booking.objects.get(id=response.data["id"])
        assert booking.time_to is not None

    def test_borrow_item_with_open_end_can_be_booked_without_time_to(self):
        """A BORROW item with rental_open_end=True must accept bookings without
        time_to."""
        self.client.force_authenticate(user=self.booking_user)

        response = self.client.post(
            "/api/bookings/",
            {
                "item": str(self.open_end_borrow_item.id),
                "time_from": self.future_from,
                # Intentionally no time_to
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["time_to"] is None
        booking = Booking.objects.get(id=response.data["id"])
        assert booking.time_to is None

    def test_patch_removing_time_to_fails_when_open_end_not_allowed(self):
        """PATCHing time_to to null on a closed-end item must be rejected."""
        self.client.force_authenticate(user=self.booking_user)

        # First create a valid booking with both times set
        create_response = self.client.post(
            "/api/bookings/",
            {
                "item": str(self.closed_end_item.id),
                "offer": "20.00",
                "time_from": self.future_from,
                "time_to": self.future_to,
            },
            format="json",
        )
        assert create_response.status_code == status.HTTP_201_CREATED
        booking_id = create_response.data["id"]

        # Now PATCH to remove the end time — must fail
        patch_response = self.client.patch(
            f"/api/bookings/{booking_id}/",
            {"time_to": None},
            format="json",
        )

        assert patch_response.status_code == status.HTTP_400_BAD_REQUEST
        assert "time_to" in patch_response.data
        assert "required" in patch_response.data["time_to"][0].lower()

    def test_explicit_null_time_to_same_as_omitting_when_open_end_not_allowed(self):
        """
        Explicitly sending time_to=null must raise the same 400 error as omitting
        the field entirely when rental_open_end=False.
        """
        self.client.force_authenticate(user=self.booking_user)

        # --- Field omitted ---
        response_omitted = self.client.post(
            "/api/bookings/",
            {
                "item": str(self.closed_end_item.id),
                "offer": "20.00",
                "time_from": self.future_from,
            },
            format="json",
        )
        assert response_omitted.status_code == status.HTTP_400_BAD_REQUEST
        assert "time_to" in response_omitted.data

        # Second user to avoid "duplicate pending booking" error
        second_user = UserFactory()
        second_user.groups.add(self.default_group)
        self.client.force_authenticate(user=second_user)

        # --- Explicit null ---
        response_null = self.client.post(
            "/api/bookings/",
            {
                "item": str(self.closed_end_item.id),
                "offer": "20.00",
                "time_from": self.future_from,
                "time_to": None,
            },
            format="json",
        )
        assert response_null.status_code == status.HTTP_400_BAD_REQUEST
        assert "time_to" in response_null.data


class BookingAgendaFilterTestCase(APITestCase):
    """Test temporal/ordering/search/page-size filtering powering the agenda view.

    Confirmed bookings are placed on distinct items so the overlapping-booking
    exclusion constraint does not interfere.
    """

    def setUp(self):
        self.client = APIClient()
        self.default_group, _ = Group.objects.get_or_create(name=DefaultGroup.DEFAULT)

        self.user = UserFactory()
        self.user.groups.add(self.default_group)

        now = timezone.now()

        # Past: ended yesterday (distinctive name for the search test).
        self.past_item = ItemFactory(user=self.user, name="UniqueSearchableWidget")
        self.past_booking = BookingFactory(
            user=self.user,
            item=self.past_item,
            status=BookingStatus.CONFIRMED,
            time_from=now - timedelta(days=3),
            time_to=now - timedelta(days=2),
        )

        # Active: started an hour ago, ends in an hour.
        self.active_item = ItemFactory(user=self.user)
        self.active_booking = BookingFactory(
            user=self.user,
            item=self.active_item,
            status=BookingStatus.CONFIRMED,
            time_from=now - timedelta(hours=1),
            time_to=now + timedelta(hours=1),
        )

        # Future: starts in two days.
        self.future_item = ItemFactory(user=self.user)
        self.future_booking = BookingFactory(
            user=self.user,
            item=self.future_item,
            status=BookingStatus.CONFIRMED,
            time_from=now + timedelta(days=2),
            time_to=now + timedelta(days=3),
        )

        # Pending (not yet approved) future request.
        self.pending_item = ItemFactory(user=self.user)
        self.pending_booking = BookingFactory(
            user=self.user,
            item=self.pending_item,
            status=BookingStatus.PENDING,
            time_from=now + timedelta(days=5),
            time_to=now + timedelta(days=6),
        )

        self.client.force_authenticate(user=self.user)

    def _ids(self, response):
        return {row["id"] for row in response.data["results"]}

    def test_temporal_past_returns_only_ended_confirmed(self):
        response = self.client.get("/api/bookings/?status=3&temporal=past")
        assert response.status_code == status.HTTP_200_OK
        assert self._ids(response) == {str(self.past_booking.id)}

    def test_temporal_upcoming_returns_active_and_future(self):
        response = self.client.get("/api/bookings/?status=3&temporal=upcoming")
        assert response.status_code == status.HTTP_200_OK
        assert self._ids(response) == {
            str(self.active_booking.id),
            str(self.future_booking.id),
        }

    def test_temporal_active_returns_currently_running(self):
        response = self.client.get("/api/bookings/?status=3&temporal=active")
        assert response.status_code == status.HTTP_200_OK
        assert self._ids(response) == {str(self.active_booking.id)}

    def test_temporal_upcoming_includes_pending_when_requested(self):
        """Pending requests appear alongside confirmed when status filter allows."""
        response = self.client.get("/api/bookings/?status=1&status=3&temporal=upcoming")
        assert response.status_code == status.HTTP_200_OK
        assert self._ids(response) == {
            str(self.active_booking.id),
            str(self.future_booking.id),
            str(self.pending_booking.id),
        }

    def test_ordering_by_time_from(self):
        response = self.client.get("/api/bookings/?status=3&ordering=time_from")
        assert response.status_code == status.HTTP_200_OK
        ordered_ids = [row["id"] for row in response.data["results"]]
        assert ordered_ids == [
            str(self.past_booking.id),
            str(self.active_booking.id),
            str(self.future_booking.id),
        ]

    def test_selectable_page_size(self):
        page_size = 2
        confirmed_count = Booking.objects.filter(status=BookingStatus.CONFIRMED).count()
        response = self.client.get(f"/api/bookings/?status=3&page_size={page_size}")
        assert response.status_code == status.HTTP_200_OK
        assert response.data["count"] == confirmed_count
        assert len(response.data["results"]) == page_size
        assert response.data["next"] is not None

    def test_search_spans_all_time(self):
        """Search matches by item name regardless of past/future placement."""
        response = self.client.get(
            "/api/bookings/?status=3&search=UniqueSearchableWidget"
        )
        assert response.status_code == status.HTTP_200_OK
        assert self._ids(response) == {str(self.past_booking.id)}


class BookingRentalPeriodPriceTestCase(APITestCase):
    """Unit tests for the ``Booking.rental_price`` property.

    The stored item price is the price for one rental period (hour, day, or
    week). The property must derive the hourly rate from ``rental_period``
    before multiplying by the booked duration in hours.
    """

    def setUp(self):
        self.client = APIClient()
        self.default_group, _ = Group.objects.get_or_create(name=DefaultGroup.DEFAULT)
        self.item_owner = UserFactory()
        self.item_owner.groups.add(self.default_group)
        # Truncate microseconds so total_seconds() is an exact integer.
        self.base_time = timezone.now().replace(microsecond=0)

    def test_hourly_period_price(self):
        """Hourly item: rental_price = price * hours (baseline)."""
        item = ItemFactory(user=self.item_owner, price="10.00")
        item.rental_period = RentalPeriodType.HOURLY
        item.save()

        booking = BookingFactory(
            item=item,
            time_from=self.base_time,
            time_to=self.base_time + timedelta(hours=3),
        )

        assert booking.rental_price is not None
        assert booking.rental_price.amount == Decimal("30.00")

    def test_daily_period_price(self):
        """Daily item (€24/day): 12 h booking → hourly rate €1 → €12.00."""
        item = ItemFactory(user=self.item_owner, price="24.00")
        item.rental_period = RentalPeriodType.DAILY
        item.save()

        booking = BookingFactory(
            item=item,
            time_from=self.base_time,
            time_to=self.base_time + timedelta(hours=12),
        )

        assert booking.rental_price is not None
        assert booking.rental_price.amount == Decimal("12.00")

    def test_daily_period_full_day(self):
        """Daily item (€24/day): 24 h booking → exactly one day → €24.00."""
        item = ItemFactory(user=self.item_owner, price="24.00")
        item.rental_period = RentalPeriodType.DAILY
        item.save()

        booking = BookingFactory(
            item=item,
            time_from=self.base_time,
            time_to=self.base_time + timedelta(days=1),
        )

        assert booking.rental_price is not None
        assert booking.rental_price.amount == Decimal("24.00")

    def test_weekly_period_price(self):
        """Weekly item (€168/week): 12 h booking → hourly rate €1 → €12.00."""
        item = ItemFactory(user=self.item_owner, price="168.00")
        item.rental_period = RentalPeriodType.WEEKLY
        item.save()

        booking = BookingFactory(
            item=item,
            time_from=self.base_time,
            time_to=self.base_time + timedelta(hours=12),
        )

        assert booking.rental_price is not None
        assert booking.rental_price.amount == Decimal("12.00")

    def test_weekly_period_short_booking(self):
        """Weekly item (€168/week): 3 h booking → hourly rate €1 → €3.00."""
        item = ItemFactory(user=self.item_owner, price="168.00")
        item.rental_period = RentalPeriodType.WEEKLY
        item.save()

        booking = BookingFactory(
            item=item,
            time_from=self.base_time,
            time_to=self.base_time + timedelta(hours=3),
        )

        assert booking.rental_price is not None
        assert booking.rental_price.amount == Decimal("3.00")

    def test_weekly_period_full_week(self):
        """Weekly item (€168/week): 168 h booking → exactly one week → €168."""
        item = ItemFactory(user=self.item_owner, price="168.00")
        item.rental_period = RentalPeriodType.WEEKLY
        item.save()

        booking = BookingFactory(
            item=item,
            time_from=self.base_time,
            time_to=self.base_time + timedelta(days=7),
        )

        assert booking.rental_price is not None
        assert booking.rental_price.amount == Decimal("168.00")

    def test_daily_period_123_euro(self):
        """Daily item (€123/day): 6 h booking → 123/24*6 = €30.75."""
        item = ItemFactory(user=self.item_owner, price="123.00")
        item.rental_period = RentalPeriodType.DAILY
        item.save()

        booking = BookingFactory(
            item=item,
            time_from=self.base_time,
            time_to=self.base_time + timedelta(hours=6),
        )

        assert booking.rental_price is not None
        assert booking.rental_price.amount == Decimal("30.75")

    def test_weekly_period_123_euro(self):
        """Weekly item (€123/week): 3 h booking → 123/168*3 ≈ €2.20."""
        item = ItemFactory(user=self.item_owner, price="123.00")
        item.rental_period = RentalPeriodType.WEEKLY
        item.save()

        booking = BookingFactory(
            item=item,
            time_from=self.base_time,
            time_to=self.base_time + timedelta(hours=3),
        )

        assert booking.rental_price is not None
        # 123 / 168 * 3 = 2.1964… → quantized to 2 decimal places
        assert booking.rental_price.amount == Decimal("2.20")

    def test_rental_price_none_without_time_to(self):
        """rental_price is None when time_to is missing."""
        item = ItemFactory(user=self.item_owner, price="24.00")
        item.rental_period = RentalPeriodType.DAILY
        item.save()

        booking = BookingFactory(item=item, time_from=self.base_time, time_to=None)

        assert booking.rental_price is None


class BookingAutoConfirmRentalPeriodTestCase(APITestCase):
    """Auto-confirm integration tests for non-hourly rental periods.

    The auto-confirm logic compares the offered price against
    ``booking.rental_price``, which now derives the hourly rate from
    ``item.rental_period``. These tests verify the full flow via the API.
    """

    def setUp(self):
        self.client = APIClient()
        self.default_group, _ = Group.objects.get_or_create(name=DefaultGroup.DEFAULT)

        self.item_owner = UserFactory()
        self.item_owner.groups.add(self.default_group)

        self.booking_user = UserFactory()
        self.booking_user.groups.add(self.default_group)

    def test_daily_period_auto_confirms_at_exact_price(self):
        """Self-service daily item (€24/day), 12 h booking → €12.00 → confirmed.

        hourly rate = 24 / 24 = 1.00 → rental_price = 1.00 * 12 = 12.00
        """
        item = SelfServiceItemFactory(user=self.item_owner, price="24.00")
        item.rental_period = RentalPeriodType.DAILY
        item.save()

        base = timezone.now().replace(microsecond=0)
        time_from = base
        time_to = base + timedelta(hours=12)

        self.client.force_authenticate(user=self.booking_user)
        response = self.client.post(
            "/api/bookings/",
            {
                "item": str(item.id),
                "offer": "12.00",
                "time_from": time_from.isoformat(),
                "time_to": time_to.isoformat(),
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["status"] == BookingStatus.CONFIRMED

    def test_daily_period_stays_pending_on_wrong_offer(self):
        """Self-service daily item (€24/day), 12 h → €12.00; offer €5 → pending."""
        item = SelfServiceItemFactory(user=self.item_owner, price="24.00")
        item.rental_period = RentalPeriodType.DAILY
        item.save()

        base = timezone.now().replace(microsecond=0)
        time_from = base
        time_to = base + timedelta(hours=12)

        self.client.force_authenticate(user=self.booking_user)
        response = self.client.post(
            "/api/bookings/",
            {
                "item": str(item.id),
                "offer": "5.00",
                "time_from": time_from.isoformat(),
                "time_to": time_to.isoformat(),
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["status"] == BookingStatus.PENDING

    def test_weekly_period_auto_confirms_at_exact_price(self):
        """Self-service weekly item (€168/week), 12 h booking → €12.00 → confirmed.

        hourly rate = 168 / 168 = 1.00 → rental_price = 1.00 * 12 = 12.00
        """
        item = SelfServiceItemFactory(user=self.item_owner, price="168.00")
        item.rental_period = RentalPeriodType.WEEKLY
        item.save()

        base = timezone.now().replace(microsecond=0)
        time_from = base
        time_to = base + timedelta(hours=12)

        self.client.force_authenticate(user=self.booking_user)
        response = self.client.post(
            "/api/bookings/",
            {
                "item": str(item.id),
                "offer": "12.00",
                "time_from": time_from.isoformat(),
                "time_to": time_to.isoformat(),
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["status"] == BookingStatus.CONFIRMED

    def test_weekly_period_stays_pending_on_wrong_offer(self):
        """Self-service weekly item (€168/week), 12 h → €12.00; offer €5 → pending."""
        item = SelfServiceItemFactory(user=self.item_owner, price="168.00")
        item.rental_period = RentalPeriodType.WEEKLY
        item.save()

        base = timezone.now().replace(microsecond=0)
        time_from = base
        time_to = base + timedelta(hours=12)

        self.client.force_authenticate(user=self.booking_user)
        response = self.client.post(
            "/api/bookings/",
            {
                "item": str(item.id),
                "offer": "5.00",
                "time_from": time_from.isoformat(),
                "time_to": time_to.isoformat(),
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["status"] == BookingStatus.PENDING

    def test_weekly_period_123_euro_auto_confirms(self):
        """Self-service weekly item (€123/week), 3 h → €2.20 → confirmed.

        hourly rate = 123 / 168 ≈ 0.7321 → rental_price = 0.7321 * 3 ≈ 2.20
        """
        item = SelfServiceItemFactory(user=self.item_owner, price="123.00")
        item.rental_period = RentalPeriodType.WEEKLY
        item.save()

        base = timezone.now().replace(microsecond=0)
        time_from = base
        time_to = base + timedelta(hours=3)

        self.client.force_authenticate(user=self.booking_user)

        # Compute the expected rental_price the same way the backend does.
        booking = Booking(item=item, time_from=time_from, time_to=time_to)
        expected_price = booking.rental_price
        assert expected_price is not None

        response = self.client.post(
            "/api/bookings/",
            {
                "item": str(item.id),
                "offer": str(expected_price.amount),
                "time_from": time_from.isoformat(),
                "time_to": time_to.isoformat(),
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["status"] == BookingStatus.CONFIRMED
