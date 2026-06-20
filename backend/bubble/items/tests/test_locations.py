"""Tests for the Location API endpoint (``/api/locations/``)."""

from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from bubble.items.models import Location
from bubble.users.tests.factories import UserFactory

TEST_PASSWORD = "testpass123"  # noqa: S105


class LocationAPITestCase(TestCase):
    """Test filtering and access rules for the read-only locations endpoint."""

    def setUp(self):
        self.client = APIClient()
        self.user = UserFactory(username="locuser", password=TEST_PASSWORD)
        self.url = reverse("api:location-list")

        # Category-scoped locations
        self.book_shelf = Location.objects.create(
            name="Sci-Fi shelf", section="Fiction", item_category="books"
        )
        self.tool_area = Location.objects.create(
            name="Workshop bench", item_category="tools"
        )
        # Category-agnostic location (blank item_category) — applies to any item
        self.shared_area = Location.objects.create(
            name="Shared storage", item_category=""
        )

    def _results(self, response):
        # The endpoint is paginated (PageNumberPagination); rows live under
        # "results". Our fixtures fit on a single page.
        return response.data["results"]

    def _names(self, response):
        return {row["name"] for row in self._results(response)}

    def test_requires_authentication(self):
        """Anonymous users may not browse locations."""
        response = self.client.get(self.url)
        self.assertIn(
            response.status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )

    def test_lists_all_locations_without_filter(self):
        self.client.login(username="locuser", password=TEST_PASSWORD)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            self._names(response),
            {"Sci-Fi shelf", "Workshop bench", "Shared storage"},
        )

    def test_filter_by_category_includes_agnostic_excludes_others(self):
        """``?item_category=books`` returns book locations + blank-category ones."""
        self.client.login(username="locuser", password=TEST_PASSWORD)
        response = self.client.get(self.url, {"item_category": "books"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        names = self._names(response)
        self.assertIn("Sci-Fi shelf", names)  # category match
        self.assertIn("Shared storage", names)  # category-agnostic
        self.assertNotIn("Workshop bench", names)  # different category

    def test_filter_by_category_tools(self):
        self.client.login(username="locuser", password=TEST_PASSWORD)
        response = self.client.get(self.url, {"item_category": "tools"})
        self.assertEqual(
            self._names(response), {"Workshop bench", "Shared storage"}
        )

    def test_serializer_exposes_category_display(self):
        self.client.login(username="locuser", password=TEST_PASSWORD)
        response = self.client.get(self.url, {"item_category": "books"})
        shelf = next(r for r in self._results(response) if r["name"] == "Sci-Fi shelf")
        self.assertEqual(shelf["section"], "Fiction")
        self.assertEqual(shelf["item_category"], "books")
        self.assertEqual(shelf["item_category_display"], "Books")
