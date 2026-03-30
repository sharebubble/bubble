"""Tests for items API."""

# mypy: ignore-errors

from decimal import Decimal
from io import BytesIO
from unittest.mock import patch

from constance import config
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse
from PIL import Image as PILImage
from rest_framework import status
from rest_framework.test import APIClient

from bubble.core.permissions_config import DefaultGroup
from bubble.items.ai.image_analyze import ItemImageResult
from bubble.items.models import Image, Item, ItemStatus, SalesType, VisibilityType
from bubble.items.tests.factories import ItemOwnerUserFactory
from bubble.users.tests.factories import UserFactory

TEST_PASSWORD = "testpass123"  # noqa: S105


class ImageAPITestCase(TestCase):
    """Test cases for Image API endpoints."""

    def setUp(self):
        """Set up test data."""
        self.client = APIClient()

        # Create test users with item permissions
        self.user1 = ItemOwnerUserFactory(
            username="testuser1", email="test1@example.com", password=TEST_PASSWORD
        )
        self.user2 = ItemOwnerUserFactory(
            username="testuser2", email="test2@example.com", password=TEST_PASSWORD
        )

        # Create test items
        self.item1 = Item.objects.create(
            name="Test Item 1",
            description="A test item",
            user=self.user1,
            sales_type=SalesType.SELL,
            price=Decimal("10.00"),
        )
        self.item2 = Item.objects.create(
            name="Test Item 2",
            description="Another test item",
            user=self.user2,
            sales_type=SalesType.SELL,
            price=Decimal("15.00"),
        )

    def create_test_image(self):
        """Create a test image file."""
        image = PILImage.new("RGB", (100, 100), color="red")
        temp_file = BytesIO()
        image.save(temp_file, format="JPEG")
        temp_file.seek(0)
        return SimpleUploadedFile(
            name="test_image.jpg", content=temp_file.read(), content_type="image/jpeg"
        )

    def test_create_image_as_item_owner(self):
        """Test that item owner can create images for their item."""
        self.client.login(username="testuser1", password=TEST_PASSWORD)

        test_image = self.create_test_image()
        data = {"item": str(self.item1.id), "original": test_image, "ordering": 1}

        url = reverse("api:image-list")  # Using the image endpoint
        response = self.client.post(url, data, format="multipart")

        assert response.status_code == status.HTTP_201_CREATED, response.status_code
        assert Image.objects.filter(item=self.item1).exists()

    def test_create_image_as_non_owner_fails(self):
        """Test that non-owner cannot create images for someone else's item."""
        self.client.login(username="testuser2", password=TEST_PASSWORD)

        test_image = self.create_test_image()
        data = {
            "item": str(self.item1.id),  # user2 trying to add image to user1's item
            "original": test_image,
            "ordering": 1,
        }

        url = reverse("api:image-list")  # Using the image endpoint
        response = self.client.post(url, data, format="multipart")

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "You can only create images for items you own" in str(response.json())
        assert not Image.objects.filter(item=self.item1).exists()

    def test_create_image_unauthenticated_fails(self):
        """Test that unauthenticated users cannot create images."""
        test_image = self.create_test_image()
        data = {"item": str(self.item1.id), "original": test_image, "ordering": 1}

        url = reverse("api:image-list")  # Using the image endpoint
        response = self.client.post(url, data, format="multipart")

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not Image.objects.filter(item=self.item1).exists()

    def test_create_multiple_images_as_owner(self):
        """Test that item owner can create multiple images for their item."""
        self.client.login(username="testuser1", password=TEST_PASSWORD)

        # Create first image
        test_image1 = self.create_test_image()
        data1 = {"item": str(self.item1.id), "original": test_image1, "ordering": 1}
        url = reverse("api:image-list")
        response1 = self.client.post(url, data1, format="multipart")
        assert response1.status_code == status.HTTP_201_CREATED

        # Create second image
        test_image2 = self.create_test_image()
        data2 = {"item": str(self.item1.id), "original": test_image2, "ordering": 2}
        response2 = self.client.post(url, data2, format="multipart")
        assert response2.status_code == status.HTTP_201_CREATED

        image_count = 2
        assert Image.objects.filter(item=self.item1).count() == image_count

    def test_create_image_with_invalid_item_id(self):
        """Test that creating image with invalid item id fails."""
        self.client.login(username="testuser1", password=TEST_PASSWORD)

        test_image = self.create_test_image()
        data = {"item": "invalid-id", "original": test_image, "ordering": 1}

        url = reverse("api:image-list")
        response = self.client.post(url, data, format="multipart")

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_delete_image_as_item_owner(self):
        """Test that item owner can delete their item's images."""
        self.client.login(username="testuser1", password=TEST_PASSWORD)

        # First create an image
        test_image = self.create_test_image()
        data = {"item": str(self.item1.id), "original": test_image, "ordering": 1}
        create_url = reverse("api:image-list")
        create_response = self.client.post(create_url, data, format="multipart")

        assert create_response.status_code == status.HTTP_201_CREATED
        created_image = Image.objects.get(item=self.item1)

        # Now delete the image
        delete_url = reverse("api:image-detail", kwargs={"id": created_image.id})
        delete_response = self.client.delete(delete_url)

        assert delete_response.status_code == status.HTTP_204_NO_CONTENT
        assert not Image.objects.filter(id=created_image.id).exists()

    def test_delete_image_as_non_owner_with_permissions(self):
        """
        Test that user with permissions can delete any image
        (current permission model).
        """
        # First, user1 creates an image
        self.client.login(username="testuser1", password=TEST_PASSWORD)
        test_image = self.create_test_image()
        data = {"item": str(self.item1.id), "original": test_image, "ordering": 1}
        create_url = reverse("api:image-list")
        create_response = self.client.post(create_url, data, format="multipart")

        assert create_response.status_code == status.HTTP_201_CREATED
        created_image = Image.objects.get(item=self.item1)

        # user2 can delete user1's image because both are in "Item Owners" group
        self.client.login(username="testuser2", password=TEST_PASSWORD)
        delete_url = reverse("api:image-detail", kwargs={"id": created_image.id})
        delete_response = self.client.delete(delete_url)

        assert delete_response.status_code == status.HTTP_404_NOT_FOUND
        assert Image.objects.filter(id=created_image.id).exists()

    def test_delete_image_without_permissions_fails(self):
        """Test that user without permissions cannot delete images."""
        # First, user1 creates an image
        self.client.login(username="testuser1", password=TEST_PASSWORD)
        test_image = self.create_test_image()
        data = {"item": str(self.item1.id), "original": test_image, "ordering": 1}
        create_url = reverse("api:image-list")
        create_response = self.client.post(create_url, data, format="multipart")

        assert create_response.status_code == status.HTTP_201_CREATED
        created_image = Image.objects.get(item=self.item1)

        UserFactory(
            username="nopermuser", email="noperm@example.com", password=TEST_PASSWORD
        )

        # User without permissions tries to delete the image
        self.client.login(username="nopermuser", password=TEST_PASSWORD)
        delete_url = reverse("api:image-detail", kwargs={"id": created_image.id})
        delete_response = self.client.delete(delete_url)

        # Should get 404 because user can't see the image (filtered out by get_queryset)
        assert delete_response.status_code == status.HTTP_403_FORBIDDEN
        assert Image.objects.filter(id=created_image.id).exists()

    def test_delete_image_unauthenticated_fails(self):
        """Test that unauthenticated users cannot delete images."""
        # First, create an image as authenticated user
        self.client.login(username="testuser1", password=TEST_PASSWORD)
        test_image = self.create_test_image()
        data = {"item": str(self.item1.id), "original": test_image, "ordering": 1}
        create_url = reverse("api:image-list")
        create_response = self.client.post(create_url, data, format="multipart")

        assert create_response.status_code == status.HTTP_201_CREATED
        created_image = Image.objects.get(item=self.item1)

        # Now try to delete as unauthenticated user
        self.client.logout()
        delete_url = reverse("api:image-detail", kwargs={"id": created_image.id})
        delete_response = self.client.delete(delete_url)

        assert delete_response.status_code == status.HTTP_403_FORBIDDEN
        assert Image.objects.filter(id=created_image.id).exists()

    def test_update_image_ordering_as_owner(self):
        """Test that item owner can update the ordering of their images."""
        self.client.login(username="testuser1", password=TEST_PASSWORD)

        # First create an image
        test_image = self.create_test_image()
        initial_ordering = 1
        updated_ordering = 5
        data = {
            "item": str(self.item1.id),
            "original": test_image,
            "ordering": initial_ordering,
        }
        create_url = reverse("api:image-list")
        create_response = self.client.post(create_url, data, format="multipart")

        assert create_response.status_code == status.HTTP_201_CREATED
        created_image = Image.objects.get(item=self.item1)
        assert created_image.ordering == initial_ordering

        # Now update the ordering
        update_url = reverse("api:image-detail", kwargs={"id": created_image.id})
        update_data = {"ordering": updated_ordering}
        update_response = self.client.patch(update_url, update_data, format="json")

        assert update_response.status_code == status.HTTP_200_OK
        created_image.refresh_from_db()
        assert created_image.ordering == updated_ordering

    def test_update_image_original_fails_for_existing_image(self):
        """Test that updating the original field fails for existing images."""
        self.client.login(username="testuser1", password=TEST_PASSWORD)

        # First create an image
        test_image = self.create_test_image()
        data = {"item": str(self.item1.id), "original": test_image, "ordering": 1}
        create_url = reverse("api:image-list")
        create_response = self.client.post(create_url, data, format="multipart")

        assert create_response.status_code == status.HTTP_201_CREATED
        created_image = Image.objects.get(item=self.item1)
        original_file = created_image.original.name

        # Try to update the original field
        new_image = self.create_test_image()
        update_url = reverse("api:image-detail", kwargs={"id": created_image.id})
        update_data = {"original": new_image}
        update_response = self.client.patch(update_url, update_data, format="multipart")

        # Should succeed but original should not change
        assert update_response.status_code == status.HTTP_200_OK
        created_image.refresh_from_db()
        assert created_image.original.name == original_file

    def test_update_image_item_fails_for_existing_image(self):
        """Test that updating the item field fails for existing images."""
        self.client.login(username="testuser1", password=TEST_PASSWORD)

        # First create an image
        test_image = self.create_test_image()
        data = {"item": str(self.item1.id), "original": test_image, "ordering": 1}
        create_url = reverse("api:image-list")
        create_response = self.client.post(create_url, data, format="multipart")

        assert create_response.status_code == status.HTTP_201_CREATED
        created_image = Image.objects.get(item=self.item1)
        original_item_id = created_image.item.id

        # Try to update the item field to item2
        update_url = reverse("api:image-detail", kwargs={"id": created_image.id})
        update_data = {"item": str(self.item2.id)}
        update_response = self.client.patch(update_url, update_data, format="json")

        # Should succeed but item should not change
        assert update_response.status_code == status.HTTP_200_OK
        created_image.refresh_from_db()
        assert created_image.item.id == original_item_id

    def test_update_image_ordering_and_other_fields_only_ordering_changes(self):
        """Test that when updating multiple fields, only ordering changes."""
        self.client.login(username="testuser1", password=TEST_PASSWORD)

        # First create an image
        test_image = self.create_test_image()
        initial_ordering = 1
        new_ordering = 10
        data = {
            "item": str(self.item1.id),
            "original": test_image,
            "ordering": initial_ordering,
        }
        create_url = reverse("api:image-list")
        create_response = self.client.post(create_url, data, format="multipart")

        assert create_response.status_code == status.HTTP_201_CREATED
        created_image = Image.objects.get(item=self.item1)
        original_file = created_image.original.name
        original_item_id = created_image.item.id

        # Try to update multiple fields including ordering
        new_image = self.create_test_image()
        update_url = reverse("api:image-detail", kwargs={"id": created_image.id})
        update_data = {
            "ordering": new_ordering,
            "original": new_image,
            "item": str(self.item2.id),
        }
        update_response = self.client.patch(update_url, update_data, format="multipart")

        # Should succeed
        assert update_response.status_code == status.HTTP_200_OK
        created_image.refresh_from_db()

        # Only ordering should change
        assert created_image.ordering == new_ordering
        assert created_image.original.name == original_file
        assert created_image.item.id == original_item_id
        assert created_image.item.id == original_item_id

    def test_update_image_non_owner_fails(self):
        """Test that non-owner cannot update image ordering."""
        self.client.login(username="testuser1", password=TEST_PASSWORD)

        # First create an image as user1
        test_image = self.create_test_image()
        data = {"item": str(self.item1.id), "original": test_image, "ordering": 1}
        create_url = reverse("api:image-list")
        create_response = self.client.post(create_url, data, format="multipart")

        assert create_response.status_code == status.HTTP_201_CREATED
        created_image = Image.objects.get(item=self.item1)

        # Try to update as user2
        self.client.login(username="testuser2", password=TEST_PASSWORD)
        update_url = reverse("api:image-detail", kwargs={"id": created_image.id})
        update_data = {"ordering": 5}
        update_response = self.client.patch(update_url, update_data, format="json")

        # Should fail with forbidden or not found (filtered by get_queryset)
        assert update_response.status_code in (
            status.HTTP_403_FORBIDDEN,
            status.HTTP_404_NOT_FOUND,
        )
        created_image.refresh_from_db()
        assert created_image.ordering == 1

    def test_create_image_without_ordering_sets_automatic_ordering(self):
        """Test that creating an image without ordering sets it automatically."""
        self.client.login(username="testuser1", password=TEST_PASSWORD)

        # Create first image without ordering
        test_image1 = self.create_test_image()
        data1 = {"item": str(self.item1.id), "original": test_image1}
        url = reverse("api:image-list")
        response1 = self.client.post(url, data1, format="multipart")

        assert response1.status_code == status.HTTP_201_CREATED
        images = list(Image.objects.filter(item=self.item1).order_by("ordering"))
        assert len(images) == 1
        assert images[0].ordering == 0  # First image should have ordering 0

        # Create second image without ordering
        test_image2 = self.create_test_image()
        data2 = {"item": str(self.item1.id), "original": test_image2}
        response2 = self.client.post(url, data2, format="multipart")

        assert response2.status_code == status.HTTP_201_CREATED
        images = list(Image.objects.filter(item=self.item1).order_by("ordering"))
        expected_images_count = 2
        assert len(images) == expected_images_count
        assert images[1].ordering == 1  # Second image should have ordering 1

        # Create third image without ordering
        test_image3 = self.create_test_image()
        data3 = {"item": str(self.item1.id), "original": test_image3}
        response3 = self.client.post(url, data3, format="multipart")

        assert response3.status_code == status.HTTP_201_CREATED
        images = list(Image.objects.filter(item=self.item1).order_by("ordering"))
        expected_images_count = 3
        third_image_ordering = 2
        assert len(images) == expected_images_count
        assert images[2].ordering == third_image_ordering

    def test_create_image_with_explicit_ordering_respects_provided_value(self):
        """Test that providing explicit ordering value is respected."""
        self.client.login(username="testuser1", password=TEST_PASSWORD)

        # Create first image with explicit ordering
        test_image1 = self.create_test_image()
        explicit_ordering = 10
        data1 = {
            "item": str(self.item1.id),
            "original": test_image1,
            "ordering": explicit_ordering,
        }
        url = reverse("api:image-list")
        response1 = self.client.post(url, data1, format="multipart")

        assert response1.status_code == status.HTTP_201_CREATED
        images = list(Image.objects.filter(item=self.item1).order_by("ordering"))
        assert len(images) == 1
        assert images[0].ordering == explicit_ordering

        # Create second image without ordering - should use automatic
        test_image2 = self.create_test_image()
        data2 = {"item": str(self.item1.id), "original": test_image2}
        response2 = self.client.post(url, data2, format="multipart")

        assert response2.status_code == status.HTTP_201_CREATED
        images = list(Image.objects.filter(item=self.item1).order_by("ordering"))
        expected_images_count = 2
        # Should be 1 because there's 1 existing image (count-based)
        automatic_ordering = 1
        assert len(images) == expected_images_count
        # Auto-assigned image has ordering=1, explicit has ordering=10
        assert images[0].ordering == automatic_ordering
        assert images[1].ordering == explicit_ordering

    def test_automatic_ordering_is_per_item(self):
        """Test that automatic ordering is calculated per item, not globally."""
        self.client.login(username="testuser1", password=TEST_PASSWORD)

        # Create a second item for user1
        item1_second = Item.objects.create(
            name="Test Item 1 Second",
            description="Another item for user1",
            user=self.user1,
            sales_type=SalesType.SELL,
            price=Decimal("20.00"),
        )

        url = reverse("api:image-list")

        # Create images for item1
        test_image1 = self.create_test_image()
        data1 = {"item": str(self.item1.id), "original": test_image1}
        response1 = self.client.post(url, data1, format="multipart")
        assert response1.status_code == status.HTTP_201_CREATED

        test_image2 = self.create_test_image()
        data2 = {"item": str(self.item1.id), "original": test_image2}
        response2 = self.client.post(url, data2, format="multipart")
        assert response2.status_code == status.HTTP_201_CREATED

        # Create images for item1_second (different item, same user)
        test_image3 = self.create_test_image()
        data3 = {"item": str(item1_second.id), "original": test_image3}
        response3 = self.client.post(url, data3, format="multipart")
        assert response3.status_code == status.HTTP_201_CREATED

        # Check ordering for item1 images
        item1_images = Image.objects.filter(item=self.item1).order_by("ordering")
        assert list(item1_images.values_list("ordering", flat=True)) == [0, 1]

        # Check ordering for item1_second images (should start from 0)
        item1_second_images = Image.objects.filter(item=item1_second).order_by(
            "ordering"
        )
        assert list(item1_second_images.values_list("ordering", flat=True)) == [0]


class ItemFilterAPITestCase(TestCase):
    """Tests for ItemViewSet filtering functionality."""

    def setUp(self):
        self.user = ItemOwnerUserFactory(
            username="filteruser", email="filter@example.com", password=TEST_PASSWORD
        )
        self.other = ItemOwnerUserFactory(
            username="otheruser", email="other@example.com", password=TEST_PASSWORD
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        # Create items with varying attributes
        self.item_draft = Item.objects.create(
            name="Draft Hammer",
            description="A strong hammer",
            user=self.user,
            sales_type=SalesType.SELL,
            price=Decimal("7.00"),
            status=ItemStatus.DRAFT,
            category="tools",
        )
        self.item_available = Item.objects.create(
            name="Available Saw",
            description="Sharp saw",
            user=self.user,
            sales_type=SalesType.RENT,
            price=Decimal("3.00"),
            status=2,  # AVAILABLE
            category="tools",
        )
        self.item_deactivated = Item.objects.create(
            name="Hidden Screwdriver",
            description="Small screwdriver",
            user=self.other,
            sales_type=SalesType.SELL,
            price=Decimal("7.00"),
            status=3,  # some other status
            category="hardware",
        )

    def test_filter_by_status_multiple_params(self):
        # Test the recommended way with multiple status parameters
        url = reverse("api:item-list") + "?status=0&status=2"
        response = self.client.get(url)
        assert response.status_code == status.HTTP_200_OK
        names = {i["name"] for i in response.json()["results"]}
        assert {self.item_draft.name, self.item_available.name}.issubset(names)

    def test_filter_published_true(self):
        # Published filter should include items with published statuses only
        url = reverse("api:item-list") + "?published=true"
        response = self.client.get(url)
        assert response.status_code == status.HTTP_200_OK
        names = {i["name"] for i in response.json()["results"]}
        assert self.item_available.name in names

    def test_filter_price_range(self):
        url = reverse("api:item-list") + "?min_price=6&max_price=10"
        response = self.client.get(url)
        assert response.status_code == status.HTTP_200_OK
        names = {i["name"] for i in response.json()["results"]}
        assert self.item_draft.name in names  # price 7 included
        assert len(names) == 1

    def test_filter_search(self):
        url = reverse("api:item-list") + "?search=saw"
        response = self.client.get(url)
        assert response.status_code == status.HTTP_200_OK
        names = {i["name"] for i in response.json()["results"]}
        assert self.item_available.name in names
        assert self.item_draft.name not in names

    def test_filter_owner(self):
        url = reverse("api:item-list") + f"?user={self.user.pk}"
        response = self.client.get(url)
        assert response.status_code == status.HTTP_200_OK
        owners = {i["name"] for i in response.json()["results"]}
        assert self.item_deactivated.name not in owners
        assert self.item_available.name in owners


class ItemOwnerUserFactoryTestCase(TestCase):
    """Test cases for ItemOwnerUserFactory."""

    def test_item_owner_user_factory_creates_user_with_group(self):
        """Test that ItemOwnerUserFactory creates a user in the Item Owners group."""
        user = ItemOwnerUserFactory()

        assert user.groups.filter(name=DefaultGroup.DEFAULT).exists()
        assert user.username is not None
        assert user.email is not None

    def test_item_owner_user_factory_with_password(self):
        """Test that ItemOwnerUserFactory creates a user with a custom password."""
        password = TEST_PASSWORD  # Use the existing test password constant
        user = ItemOwnerUserFactory(password=password)

        assert user.check_password(password)
        assert user.groups.filter(name=DefaultGroup.DEFAULT).exists()


class AnonymousUserItemAccessTestCase(TestCase):
    """Tests for anonymous user access to ItemViewSet."""

    def setUp(self):
        config.REQUIRE_LOGIN = False
        self.client = APIClient()
        self.user = ItemOwnerUserFactory(
            username="testowner", email="owner@example.com", password=TEST_PASSWORD
        )

        # Create items with different statuses
        self.draft_item = Item.objects.create(
            name="Draft Item",
            description="This is a draft item",
            user=self.user,
            sales_type=SalesType.SELL,
            price=Decimal("10.00"),
            status=ItemStatus.DRAFT,  # Not published - not visible to anonymous
            visibility=VisibilityType.PUBLIC,
            category="TOOLS",
        )
        self.published_item = Item.objects.create(
            name="Published Item",
            description="This is a published item",
            user=self.user,
            sales_type=SalesType.SELL,
            price=Decimal("20.00"),
            status=ItemStatus.AVAILABLE,  # Published - visible to anonymous users
            visibility=VisibilityType.PUBLIC,
            category="TOOLS",
        )

    def tearDown(self):
        """Restore default constance config."""
        config.REQUIRE_LOGIN = True

    def test_anonymous_user_can_view_published_items_only(self):
        """Test that anonymous users can only see published items."""
        url = reverse("api:public-item-list")
        response = self.client.get(url)

        assert response.status_code == status.HTTP_200_OK
        results = response.json()["results"]
        names = {item["name"] for item in results}

        # Anonymous users should only see published items
        assert self.published_item.name in names
        assert self.draft_item.name not in names

    def test_authenticated_user_sees_own_and_published_items(self):
        """Test that authenticated users see their own items plus published items."""
        self.client.login(username="testowner", password=TEST_PASSWORD)

        url = reverse("api:item-list")
        response = self.client.get(url)

        assert response.status_code == status.HTTP_200_OK
        results = response.json()["results"]
        names = {item["name"] for item in results}

        # Authenticated users should see both their own items and published items
        assert self.published_item.name in names
        assert self.draft_item.name in names


class PublishedEndpointFilterTestCase(TestCase):
    """Test cases for filtering and searching on the published endpoint."""

    def setUp(self):
        """Set up test data."""
        config.REQUIRE_LOGIN = False
        self.client = APIClient()
        self.user = ItemOwnerUserFactory(
            username="testowner", email="owner@example.com", password=TEST_PASSWORD
        )

        # Create published items with different attributes
        self.published_laptop = Item.objects.create(
            name="Gaming Laptop",
            description="High-performance laptop for gaming",
            user=self.user,
            status=ItemStatus.AVAILABLE,
            visibility=VisibilityType.PUBLIC,
            sales_type=SalesType.SELL,
            price=Decimal("1500.00"),
            category="electronics",
        )

        self.published_desk = Item.objects.create(
            name="Wooden Desk",
            description="Beautiful oak desk for home office",
            user=self.user,
            status=ItemStatus.AVAILABLE,
            visibility=VisibilityType.PUBLIC,
            sales_type=SalesType.SELL,
            price=Decimal("300.00"),
            category="furniture",
        )

        self.published_chair = Item.objects.create(
            name="Office Chair",
            description="Ergonomic office chair",
            user=self.user,
            status=ItemStatus.RESERVED,
            visibility=VisibilityType.PUBLIC,
            sales_type=SalesType.SELL,
            price=Decimal("200.00"),
            category="furniture",
        )

        # Create a draft item (should not appear in published endpoint)
        self.draft_item = Item.objects.create(
            name="Draft Laptop",
            description="Another laptop in draft",
            user=self.user,
            status=ItemStatus.DRAFT,
            visibility=VisibilityType.PUBLIC,
            sales_type=SalesType.SELL,
            price=Decimal("1000.00"),
            category="electronics",
        )

    def tearDown(self):
        """Restore default constance config."""
        config.REQUIRE_LOGIN = True

    def test_published_endpoint_search_filter(self):
        """Test that search filter works on published endpoint."""
        url = reverse("api:public-item-list") + "?search=laptop"
        response = self.client.get(url)

        assert response.status_code == status.HTTP_200_OK
        results = response.json()["results"]
        names = {item["name"] for item in results}

        # Should find the published laptop but not the draft one
        assert self.published_laptop.name in names
        assert self.draft_item.name not in names
        assert self.published_desk.name not in names

    def test_published_endpoint_category_filter(self):
        """Test that category filter works on published endpoint."""
        url = reverse("api:public-item-list") + "?category=furniture"
        response = self.client.get(url)

        assert response.status_code == status.HTTP_200_OK
        results = response.json()["results"]
        names = {item["name"] for item in results}

        # Should find furniture items only
        assert self.published_desk.name in names
        assert self.published_chair.name in names
        assert self.published_laptop.name not in names

    def test_published_endpoint_price_range_filter(self):
        """Test that price range filter works on published endpoint."""
        url = reverse("api:public-item-list") + "?min_price=250&max_price=350"
        response = self.client.get(url)

        assert response.status_code == status.HTTP_200_OK
        results = response.json()["results"]
        names = {item["name"] for item in results}

        # Should find only the desk (300)
        assert self.published_desk.name in names
        assert self.published_laptop.name not in names
        assert self.published_chair.name not in names

    def test_published_endpoint_ordering(self):
        """Test that ordering works on published endpoint."""
        url = reverse("api:public-item-list") + "?ordering=price"
        response = self.client.get(url)

        assert response.status_code == status.HTTP_200_OK
        results = response.json()["results"]

        # Should be ordered by price ascending
        prices = [Decimal(item["price"]) for item in results]
        assert prices == sorted(prices)

    def test_published_endpoint_combined_filters(self):
        """Test that multiple filters work together on published endpoint."""
        url = (
            reverse("api:public-item-list")
            + "?category=furniture&search=office&ordering=-price"
        )
        response = self.client.get(url)

        assert response.status_code == status.HTTP_200_OK
        results = response.json()["results"]
        names = {item["name"] for item in results}

        # Should find items that are furniture AND contain "office"
        assert self.published_desk.name in names
        assert self.published_chair.name in names
        assert self.published_laptop.name not in names


class AIDescribeItemTestCase(TestCase):
    """Test cases for the ai_describe_item endpoint."""

    def setUp(self):
        """Set up test data."""
        self.client = APIClient()

        # Create test user with item permissions
        self.owner = ItemOwnerUserFactory(
            username="itemowner", email="owner@example.com", password=TEST_PASSWORD
        )
        self.other_user = ItemOwnerUserFactory(
            username="otheruser", email="other@example.com", password=TEST_PASSWORD
        )

        # Create test item with owner
        self.item = Item.objects.create(
            name="Test Item",
            description="Original description",
            user=self.owner,
            sales_type=SalesType.SELL,
            price=Decimal("10.00"),
        )

        # Create test image for the item
        test_image = self.create_test_image()
        self.image = Image.objects.create(
            item=self.item, original=test_image, ordering=1
        )

    def create_test_image(self):
        """Create a test image file."""
        img = PILImage.new("RGB", (100, 100), color="red")
        img_io = BytesIO()
        img.save(img_io, format="JPEG")
        img_io.seek(0)
        return SimpleUploadedFile(
            "test_image.jpg", img_io.getvalue(), content_type="image/jpeg"
        )

    @patch("bubble.items.api.views.analyze_image")
    def test_owner_can_call_ai_describe_item(self, mock_analyze_image):
        """Test that item owner can call ai_describe_item endpoint."""
        # Mock the analyze_image function to return test data
        mock_analyze_image.return_value = ItemImageResult(
            title="AI Generated Title",
            description="AI Generated Description",
            category="tools",
            price="25.00",
        )

        # Authenticate as the item owner
        self.client.force_authenticate(user=self.owner)

        # Call the ai_describe_item endpoint
        url = reverse("api:item-ai-describe", kwargs={"id": self.item.id})
        response = self.client.put(url)

        # Assert successful response
        assert response.status_code == status.HTTP_200_OK

        # Verify the item was updated with AI data
        self.item.refresh_from_db()
        assert self.item.name == "AI Generated Title"
        assert self.item.description == "AI Generated Description"
        assert self.item.category == "tools"

        # Verify analyze_image was called with correct image id
        mock_analyze_image.assert_called_once_with(self.image.id, language="de")

    @patch("bubble.items.api.views.analyze_image")
    def test_non_owner_cannot_call_ai_describe_item(self, mock_analyze_image):
        """Test that non-owner cannot call ai_describe_item endpoint."""
        # Authenticate as a different user
        self.client.force_authenticate(user=self.other_user)

        # Try to call the ai_describe_item endpoint
        url = reverse("api:item-ai-describe", kwargs={"id": self.item.id})
        response = self.client.put(url)

        # Assert permission denied
        assert response.status_code == status.HTTP_404_NOT_FOUND

        # Verify the item was not modified
        self.item.refresh_from_db()
        assert self.item.name == "Test Item"
        assert self.item.description == "Original description"

        # Verify analyze_image was not called
        mock_analyze_image.assert_not_called()

    @patch("bubble.items.api.views.analyze_image")
    def test_unauthenticated_user_cannot_call_ai_describe_item(
        self, mock_analyze_image
    ):
        """Test that unauthenticated users cannot call ai_describe_item endpoint."""
        # Don't authenticate

        # Try to call the ai_describe_item endpoint
        url = reverse("api:item-ai-describe", kwargs={"id": self.item.id})
        response = self.client.put(url)

        # Assert forbidden or unauthorized
        assert response.status_code in (
            status.HTTP_401_UNAUTHORIZED,
            status.HTTP_403_FORBIDDEN,
        )

        # Verify the item was not modified
        self.item.refresh_from_db()
        assert self.item.name == "Test Item"

        # Verify analyze_image was not called
        mock_analyze_image.assert_not_called()


class ItemSerializerValidationTestCase(TestCase):
    """Tests for ItemSerializer sales_type / price validation rules.

    Covers creation and partial-update scenarios to verify that the unified
    sales_type + price rules are enforced at the API level, not just at the
    database level.
    """

    def setUp(self):
        self.client = APIClient()
        self.user = ItemOwnerUserFactory(
            username="valuser", email="val@example.com", password=TEST_PASSWORD
        )
        self.client.force_authenticate(user=self.user)
        self.url_list = reverse("api:item-list")

    def _create_url(self):
        return self.url_list

    def _detail_url(self, item):
        return reverse("api:item-detail", kwargs={"id": item.id})

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _base_payload(self, **overrides):
        """Minimal valid payload for a SELL item."""
        payload = {
            "name": "Test Item",
            "description": "desc",
            "sales_type": SalesType.SELL,
            "price": "10.00",
        }
        payload.update(overrides)
        return payload

    def _create_item_direct(self, sales_type, price=None):
        """Create an Item directly in the DB (bypassing serializer) for PATCH tests."""
        kwargs = {
            "name": "Direct Item",
            "description": "desc",
            "user": self.user,
            "sales_type": sales_type,
        }
        if price is not None:
            kwargs["price"] = Decimal(price)
        return Item.objects.create(**kwargs)

    # ------------------------------------------------------------------
    # Creation: SELL / RENT require price > 0
    # ------------------------------------------------------------------

    def test_create_sell_without_price_succeeds(self):
        """SELL item with no price → 201 (price is optional)."""
        payload = self._base_payload(sales_type=SalesType.SELL)
        del payload["price"]
        response = self.client.post(self._create_url(), payload, format="json")
        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()["price"] is None

    def test_create_rent_without_price_succeeds(self):
        """RENT item with no price → 201 (price is optional for rent)."""
        payload = self._base_payload(sales_type=SalesType.RENT)
        del payload["price"]
        response = self.client.post(self._create_url(), payload, format="json")
        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()["price"] is None

    def test_create_sell_with_zero_price_fails(self):
        """SELL item with price = 0 → 400 with price error."""
        payload = self._base_payload(sales_type=SalesType.SELL, price="0.00")
        response = self.client.post(self._create_url(), payload, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "price" in response.json()

    def test_create_rent_with_negative_price_fails(self):
        """RENT item with price < 0 → 400 with price error."""
        payload = self._base_payload(sales_type=SalesType.RENT, price="-5.00")
        response = self.client.post(self._create_url(), payload, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "price" in response.json()

    def test_create_sell_with_valid_price_succeeds(self):
        """SELL item with price > 0 → 201."""
        payload = self._base_payload(sales_type=SalesType.SELL, price="9.99")
        response = self.client.post(self._create_url(), payload, format="json")
        assert response.status_code == status.HTTP_201_CREATED

    def test_create_rent_with_valid_price_succeeds(self):
        """RENT item with price > 0 → 201."""
        payload = self._base_payload(sales_type=SalesType.RENT, price="5.00")
        response = self.client.post(self._create_url(), payload, format="json")
        assert response.status_code == status.HTTP_201_CREATED

    # ------------------------------------------------------------------
    # Creation: DONATE / BORROW auto-clear price if provided
    # ------------------------------------------------------------------

    def test_create_donate_with_price_auto_clears(self):
        """DONATE item with a non-null price → 201, price auto-cleared."""
        payload = self._base_payload(sales_type=SalesType.DONATE, price="1.00")
        response = self.client.post(self._create_url(), payload, format="json")
        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()["price"] is None

    def test_create_borrow_with_price_auto_clears(self):
        """BORROW item with a non-null price → 201, price auto-cleared."""
        payload = self._base_payload(sales_type=SalesType.BORROW, price="1.00")
        response = self.client.post(self._create_url(), payload, format="json")
        assert response.status_code == status.HTTP_201_CREATED
        assert response.json()["price"] is None

    def test_create_donate_without_price_succeeds(self):
        """DONATE item with no price → 201."""
        payload = self._base_payload(sales_type=SalesType.DONATE)
        del payload["price"]
        response = self.client.post(self._create_url(), payload, format="json")
        assert response.status_code == status.HTTP_201_CREATED

    def test_create_borrow_without_price_succeeds(self):
        """BORROW item with no price → 201."""
        payload = self._base_payload(sales_type=SalesType.BORROW)
        del payload["price"]
        response = self.client.post(self._create_url(), payload, format="json")
        assert response.status_code == status.HTTP_201_CREATED

    # ------------------------------------------------------------------
    # Creation: WANT_BUY / WANT_RENT are unconstrained
    # ------------------------------------------------------------------

    def test_create_want_buy_without_price_succeeds(self):
        """WANT_BUY item with no price → 201."""
        payload = self._base_payload(sales_type=SalesType.WANT_BUY)
        del payload["price"]
        response = self.client.post(self._create_url(), payload, format="json")
        assert response.status_code == status.HTTP_201_CREATED

    def test_create_want_buy_with_price_succeeds(self):
        """WANT_BUY item with a price → 201 (no constraint)."""
        payload = self._base_payload(sales_type=SalesType.WANT_BUY, price="50.00")
        response = self.client.post(self._create_url(), payload, format="json")
        assert response.status_code == status.HTTP_201_CREATED

    def test_create_want_rent_without_price_succeeds(self):
        """WANT_RENT item with no price → 201."""
        payload = self._base_payload(sales_type=SalesType.WANT_RENT)
        del payload["price"]
        response = self.client.post(self._create_url(), payload, format="json")
        assert response.status_code == status.HTTP_201_CREATED

    def test_create_want_rent_with_price_succeeds(self):
        """WANT_RENT item with a price → 201 (no constraint)."""
        payload = self._base_payload(sales_type=SalesType.WANT_RENT, price="20.00")
        response = self.client.post(self._create_url(), payload, format="json")
        assert response.status_code == status.HTTP_201_CREATED

    # ------------------------------------------------------------------
    # Partial updates: sales_type changed without touching price
    # ------------------------------------------------------------------

    def test_patch_donate_to_sell_without_price_succeeds(self):
        """DONATE (no price) → PATCH sales_type=SELL without adding price → 200.

        Price is optional for sell items.
        """
        item = self._create_item_direct(SalesType.DONATE, price=None)
        response = self.client.patch(
            self._detail_url(item),
            {"sales_type": SalesType.SELL},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["price"] is None

    def test_patch_donate_to_rent_without_price_succeeds(self):
        """DONATE (no price) → PATCH sales_type=RENT without adding price → 200.

        Price is optional for rent items.
        """
        item = self._create_item_direct(SalesType.DONATE, price=None)
        response = self.client.patch(
            self._detail_url(item),
            {"sales_type": SalesType.RENT},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["price"] is None

    def test_patch_sell_to_donate_auto_clears_price(self):
        """SELL (price set) → PATCH sales_type=DONATE → 200, price auto-cleared.

        When changing sales_type to DONATE, the price is automatically cleared.
        """
        item = self._create_item_direct(SalesType.SELL, price="15.00")
        response = self.client.patch(
            self._detail_url(item),
            {"sales_type": SalesType.DONATE},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["price"] is None

    def test_patch_sell_price_to_zero_fails(self):
        """SELL item → PATCH price=0 without changing sales_type → 400."""
        item = self._create_item_direct(SalesType.SELL, price="10.00")
        response = self.client.patch(
            self._detail_url(item),
            {"price": "0.00"},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "price" in response.json()

    def test_patch_donate_add_price_fails(self):
        """DONATE item → PATCH price to a positive value → 400."""
        item = self._create_item_direct(SalesType.DONATE, price=None)
        response = self.client.patch(
            self._detail_url(item),
            {"price": "5.00"},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "price" in response.json()

    # ------------------------------------------------------------------
    # Partial updates: valid transitions
    # ------------------------------------------------------------------

    def test_patch_donate_to_sell_with_price_succeeds(self):
        """DONATE → PATCH sales_type=SELL + price together → 200."""
        item = self._create_item_direct(SalesType.DONATE, price=None)
        response = self.client.patch(
            self._detail_url(item),
            {"sales_type": SalesType.SELL, "price": "12.00"},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        item.refresh_from_db()
        assert item.sales_type == SalesType.SELL
        assert item.price.amount == Decimal("12.00")

    def test_patch_sell_to_donate_clearing_price_succeeds(self):
        """SELL → PATCH sales_type=DONATE + price=null together → 200."""
        item = self._create_item_direct(SalesType.SELL, price="10.00")
        response = self.client.patch(
            self._detail_url(item),
            {"sales_type": SalesType.DONATE, "price": None},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        item.refresh_from_db()
        assert item.sales_type == SalesType.DONATE
        assert item.price is None

    def test_patch_want_buy_price_to_null_succeeds(self):
        """WANT_BUY with price → PATCH price=null → 200 (no constraint)."""
        item = self._create_item_direct(SalesType.WANT_BUY, price="30.00")
        response = self.client.patch(
            self._detail_url(item),
            {"price": None},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK

    def test_patch_sell_update_price_succeeds(self):
        """SELL item → PATCH price to a new positive value → 200."""
        item = self._create_item_direct(SalesType.SELL, price="10.00")
        response = self.client.patch(
            self._detail_url(item),
            {"price": "25.00"},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        item.refresh_from_db()
        assert item.price.amount == Decimal("25.00")
