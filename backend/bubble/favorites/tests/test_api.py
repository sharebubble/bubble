"""API tests for item favorites.

Covers the three surfaces the feature is built for: marking/unmarking an item
from its detail page, the newest-first ordering the start page relies on, and
the full list shown in the profile area — plus the visibility rules that decide
which items may be favorited and stay listed.
"""

import pytest
from django.urls import reverse
from guardian.shortcuts import assign_perm, remove_perm
from rest_framework import status
from rest_framework.test import APIClient

from bubble.favorites.models import FavoriteItem
from bubble.items.models import Item, ItemStatus, VisibilityType
from bubble.users.tests.factories import UserFactory

LIST_URL = "api:favorite-list"
DETAIL_URL = "api:favorite-detail"
ITEM_IDS_URL = "api:favorite-item-ids"


@pytest.fixture
def owner(db):
    return UserFactory()


@pytest.fixture
def user(db):
    return UserFactory()


@pytest.fixture
def client(user):
    api_client = APIClient()
    api_client.force_authenticate(user=user)
    return api_client


def _item(owner, name="Item", visibility=VisibilityType.PUBLIC, **kwargs):
    return Item.objects.create(
        name=name,
        description="an item",
        user=owner,
        status=kwargs.pop("status", ItemStatus.AVAILABLE),
        visibility=visibility,
        **kwargs,
    )


@pytest.fixture
def public_item(owner):
    return _item(owner, name="Public Item")


def _detail_url(item):
    return reverse(DETAIL_URL, kwargs={"item_id": str(item.pk)})


@pytest.mark.django_db
class TestMarkFavorite:
    def test_mark_item_as_favorite(self, client, user, public_item):
        response = client.post(
            reverse(LIST_URL), {"item": str(public_item.pk)}, format="json"
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["item"] == public_item.pk
        assert response.data["item_detail"]["name"] == "Public Item"
        assert FavoriteItem.objects.filter(user=user, item=public_item).exists()

    def test_marking_twice_keeps_a_single_favorite(self, client, user, public_item):
        first = client.post(
            reverse(LIST_URL), {"item": str(public_item.pk)}, format="json"
        )
        second = client.post(
            reverse(LIST_URL), {"item": str(public_item.pk)}, format="json"
        )

        assert first.status_code == status.HTTP_201_CREATED
        assert second.status_code == status.HTTP_200_OK
        assert FavoriteItem.objects.filter(user=user, item=public_item).count() == 1

    def test_cannot_mark_an_invisible_item(self, client, owner):
        private_item = _item(owner, name="Private", visibility=VisibilityType.PRIVATE)

        response = client.post(
            reverse(LIST_URL), {"item": str(private_item.pk)}, format="json"
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not FavoriteItem.objects.exists()

    def test_can_mark_an_item_shared_with_the_user(self, client, user, owner):
        shared = _item(owner, name="Shared", visibility=VisibilityType.SPECIFIC)
        assign_perm("items.view_item", user, shared)

        response = client.post(
            reverse(LIST_URL), {"item": str(shared.pk)}, format="json"
        )

        assert response.status_code == status.HTTP_201_CREATED

    def test_anonymous_users_cannot_mark(self, public_item):
        response = APIClient().post(
            reverse(LIST_URL), {"item": str(public_item.pk)}, format="json"
        )

        assert response.status_code in (
            status.HTTP_401_UNAUTHORIZED,
            status.HTTP_403_FORBIDDEN,
        )


@pytest.mark.django_db
class TestUnmarkFavorite:
    def test_unmark_by_item_id(self, client, user, public_item):
        FavoriteItem.objects.create(user=user, item=public_item)

        response = client.delete(_detail_url(public_item))

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not FavoriteItem.objects.filter(user=user).exists()

    def test_cannot_unmark_someone_elses_favorite(self, client, owner, public_item):
        other_favorite = FavoriteItem.objects.create(user=owner, item=public_item)

        response = client.delete(_detail_url(public_item))

        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert FavoriteItem.objects.filter(pk=other_favorite.pk).exists()


@pytest.mark.django_db
class TestListFavorites:
    def test_newest_marked_first(self, client, user, owner):
        first = _item(owner, name="First")
        second = _item(owner, name="Second")
        third = _item(owner, name="Third")
        for item in (first, second, third):
            FavoriteItem.objects.create(user=user, item=item)

        response = client.get(reverse(LIST_URL))

        assert response.status_code == status.HTTP_200_OK
        names = [entry["item_detail"]["name"] for entry in response.data["results"]]
        assert names == ["Third", "Second", "First"]

    def test_only_own_favorites_are_listed(self, client, user, owner, public_item):
        mine = _item(owner, name="Mine")
        FavoriteItem.objects.create(user=user, item=mine)
        FavoriteItem.objects.create(user=owner, item=public_item)

        response = client.get(reverse(LIST_URL))

        assert [entry["item_detail"]["name"] for entry in response.data["results"]] == [
            "Mine"
        ]

    def test_item_that_became_invisible_drops_out(self, client, user, owner):
        shared = _item(owner, name="Shared", visibility=VisibilityType.SPECIFIC)
        assign_perm("items.view_item", user, shared)
        FavoriteItem.objects.create(user=user, item=shared)

        remove_perm("items.view_item", user, shared)

        response = client.get(reverse(LIST_URL))

        assert response.data["results"] == []

    def test_anonymous_users_cannot_list(self):
        response = APIClient().get(reverse(LIST_URL))

        assert response.status_code in (
            status.HTTP_401_UNAUTHORIZED,
            status.HTTP_403_FORBIDDEN,
        )


@pytest.mark.django_db
class TestFavoriteItemIds:
    def test_returns_only_the_users_marked_item_ids(self, client, user, owner):
        mine = _item(owner, name="Mine")
        theirs = _item(owner, name="Theirs")
        FavoriteItem.objects.create(user=user, item=mine)
        FavoriteItem.objects.create(user=owner, item=theirs)

        response = client.get(reverse(ITEM_IDS_URL))

        assert response.status_code == status.HTTP_200_OK
        assert response.data["item_ids"] == [str(mine.pk)]
