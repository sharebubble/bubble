"""Tests for relevance-ranked book search."""

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework import status
from rest_framework.test import APIRequestFactory, force_authenticate

from bubble.books.api.views import BookViewSet
from bubble.core.permissions_config import DefaultGroup
from bubble.core.signals import create_default_groups_and_permissions
from bubble.items.models import Item

User = get_user_model()


@pytest.mark.django_db
class TestBookSearchRanking:
    """Books search over title, description and the JSONB metadata."""

    def setup_method(self):
        create_default_groups_and_permissions()

        self.factory = APIRequestFactory()
        self.user = User.objects.create_user(  # pyright: ignore[reportAttributeAccessIssue]
            username="booksearch",
            password="test12345",
        )
        self.user.groups.add(Group.objects.get(name=DefaultGroup.DEFAULT))  # pyright: ignore[reportAttributeAccessIssue]

        def make(name, description, properties=None):
            return Item.objects.create(
                name=name,
                description=description,
                user=self.user,
                category="books",
                properties=properties or {},
            )

        self.title_hit = make("Dune", "A science fiction classic")
        self.description_hit = make("Sandworms", "Set in the Dune universe")
        self.author_hit = make(
            "Children of the desert",
            "An unrelated blurb",
            {"authors": ["Frank Dune"], "isbn": "9780441013593"},
        )
        self.view = BookViewSet.as_view({"get": "list"})

    def _search(self, term):
        request = self.factory.get("/api/books/", {"search": term})
        force_authenticate(request, user=self.user)
        response = self.view(request)
        assert response.status_code == status.HTTP_200_OK
        results = response.data
        if isinstance(results, dict):
            results = results["results"]
        return [book["name"] for book in results]

    def test_title_match_ranks_first(self):
        names = self._search("dune")
        assert names[0] == self.title_hit.name
        assert set(names) == {
            self.title_hit.name,
            self.description_hit.name,
            self.author_hit.name,
        }

    def test_book_metadata_is_searchable(self):
        assert self._search("9780441013593") == [self.author_hit.name]
