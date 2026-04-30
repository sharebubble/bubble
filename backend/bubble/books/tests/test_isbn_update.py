from unittest.mock import MagicMock, patch

import pytest
import requests as requests_lib
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework import status
from rest_framework.test import APIRequestFactory, force_authenticate

from bubble.books.api.views import BookViewSet
from bubble.core.permissions_config import DefaultGroup
from bubble.core.signals import create_default_groups_and_permissions
from bubble.items.models import Item

User = get_user_model()

SAMPLE_LOOKUP_RESPONSE = {
    "isbn": "9780980200447",
    "title": "Updated Book Title",
    "description": "A fascinating description of the book.",
    "authors": ["Test Author", "Second Author"],
    "genres": ["Fantasy", "Adventure"],
    "publication_year": 2020,
    "topic": "Magic",
    "publisher": "Test Publisher",
    "cover_image": None,
    "language": "en",
    "sources": ["google_books"],
}


def _make_mock_response(json_data=None, status_code=200, raise_for_status=None):
    """Build a mock requests.Response."""
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    mock_resp.json.return_value = json_data or {}
    if raise_for_status is not None:
        mock_resp.raise_for_status.side_effect = raise_for_status
    else:
        mock_resp.raise_for_status.return_value = None
    return mock_resp


@pytest.mark.django_db
class TestBookViewSetISBNUpdate:
    def setup_method(self):
        # Ensure default groups and permissions are created
        create_default_groups_and_permissions()

        self.factory = APIRequestFactory()
        self.user = User.objects.create_user(  # pyright: ignore[reportAttributeAccessIssue]
            username="testuser",
            password="test12345",
        )
        # add user to default group to have permissions
        self.user.groups.add(Group.objects.get(name=DefaultGroup.DEFAULT))  # pyright: ignore[reportAttributeAccessIssue]
        self.book = Item.objects.create(
            name="Test Book",
            user=self.user,
            category="books",
            properties={"isbn": "9780980200447"},
        )
        self.view = BookViewSet.as_view({"put": "isbn_update"})
        self.url = f"/api/books/{self.book.id}/isbn_update/"

    @patch("bubble.books.services.requests.get")
    def test_isbn_update_success(self, mock_get):
        mock_get.return_value = _make_mock_response(json_data=SAMPLE_LOOKUP_RESPONSE)

        request = self.factory.put(self.url, {"isbn": "9780-980200447"})
        force_authenticate(request, user=self.user)
        response = self.view(request, id=str(self.book.id))

        assert response.status_code == status.HTTP_200_OK
        mock_get.assert_called_once_with(
            "http://isbn-search:8000/book/9780980200447", timeout=10
        )

        self.book.refresh_from_db()
        assert self.book.name == "Updated Book Title"
        assert self.book.description == "A fascinating description of the book."
        assert self.book.properties["isbn"] == "9780980200447"
        assert (
            self.book.properties["year"] == SAMPLE_LOOKUP_RESPONSE["publication_year"]
        )
        assert self.book.properties["authors"] == ["Second Author", "Test Author"]
        assert self.book.properties["publisher"] == "Test Publisher"
        assert self.book.properties["genres"] == ["Fantasy", "Adventure"]
        assert self.book.properties["language"] == "en"
        assert self.book.properties["topic"] == "Magic"
        assert self.book.properties["metadata"] == SAMPLE_LOOKUP_RESPONSE

    def test_isbn_update_no_isbn(self):
        self.book.properties = {}
        self.book.save()
        request = self.factory.put(self.url)
        force_authenticate(request, user=self.user)
        response = self.view(request, id=str(self.book.id))

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert (
            response.data["error"]
            == "Book does not have an ISBN and none was provided."
        )

    def test_isbn_update_invalid_isbn(self):
        # Local canonicalization rejects this without any HTTP call
        request = self.factory.put(self.url, {"isbn": "not-an-isbn"})
        force_authenticate(request, user=self.user)
        response = self.view(request, id=str(self.book.id))

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "Invalid ISBN format" in str(response.data)

    @patch("bubble.books.services.requests.get")
    def test_isbn_update_metadata_not_found(self, mock_get):
        http_error = requests_lib.HTTPError(response=MagicMock(status_code=404))
        mock_get.return_value = _make_mock_response(raise_for_status=http_error)

        request = self.factory.put(self.url, {"isbn": "9780980200447"})
        force_authenticate(request, user=self.user)
        response = self.view(request, id=str(self.book.id))

        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert "No metadata found" in str(response.data)
