"""Tests for the calendar-link management API."""

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from bubble.caldav.models import CalendarLink
from bubble.collections.models import Collection
from bubble.users.tests.factories import UserFactory

from .factories import RentItemFactory, SellItemFactory


class ItemCalendarLinkApiTests(TestCase):
    def setUp(self):
        self.owner = UserFactory()
        self.other = UserFactory()
        self.item = RentItemFactory(user=self.owner)
        self.client = APIClient()

    def url(self, item=None):
        item = item or self.item
        return f"/api/items/{item.id}/calendar-link/"

    def test_owner_gets_feed_url(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.get(self.url())
        assert resp.status_code == status.HTTP_200_OK, resp.content
        assert ".ics" in resp.data["feed_url"]
        # The item slug is embedded in the URL so calendar clients name the
        # subscription after the item.
        assert self.item.slug in resp.data["feed_url"]
        assert resp.data["webcal_url"].startswith("webcal://")
        assert resp.data["kind"] == "item"
        assert resp.data["can_manage"] is True

    def test_get_is_idempotent(self):
        self.client.force_authenticate(self.owner)
        first = self.client.get(self.url()).data["feed_url"]
        second = self.client.get(self.url()).data["feed_url"]
        assert first == second

    def test_regenerate_changes_secret(self):
        self.client.force_authenticate(self.owner)
        first = self.client.get(self.url()).data["feed_url"]
        regenerated = self.client.post(self.url()).data["feed_url"]
        assert first != regenerated
        # Old secret (the path segment after /item/) no longer resolves.
        old_secret = first.split("/caldav/item/")[1].split("/")[0]
        assert not CalendarLink.objects.filter(secret=old_secret).exists()

    def test_delete_revokes(self):
        self.client.force_authenticate(self.owner)
        self.client.get(self.url())
        resp = self.client.delete(self.url())
        assert resp.status_code == status.HTTP_204_NO_CONTENT
        assert not CalendarLink.objects.filter(kind="item", item=self.item).exists()

    def test_logged_in_non_owner_can_view_public_item_feed(self):
        # RentItemFactory is PUBLIC + published, so any logged-in user may
        # subscribe — but cannot manage (rotate/revoke) it.
        self.client.force_authenticate(self.other)
        resp = self.client.get(self.url())
        assert resp.status_code == status.HTTP_200_OK, resp.content
        assert resp.data["can_manage"] is False

    def test_non_owner_cannot_regenerate(self):
        self.client.force_authenticate(self.other)
        resp = self.client.post(self.url())
        assert resp.status_code in (403, 404)

    def test_non_viewable_private_item_forbidden(self):
        private_item = RentItemFactory(user=self.owner, visibility=3)  # PRIVATE
        self.client.force_authenticate(self.other)
        resp = self.client.get(self.url(private_item))
        assert resp.status_code in (403, 404)

    def test_anonymous_unauthorized(self):
        resp = self.client.get(self.url())
        assert resp.status_code in (401, 403)

    def test_non_bookable_item_rejected(self):
        sell = SellItemFactory(user=self.owner)
        self.client.force_authenticate(self.owner)
        resp = self.client.get(self.url(sell))
        assert resp.status_code == status.HTTP_400_BAD_REQUEST


class CollectionCalendarLinkApiTests(TestCase):
    def setUp(self):
        self.owner = UserFactory()
        self.other = UserFactory()
        self.collection = Collection.objects.create(name="Shed", owner=self.owner)
        self.client = APIClient()

    def url(self):
        return f"/api/collections/{self.collection.id}/calendar-link/"

    def test_owner_gets_feed(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.get(self.url())
        assert resp.status_code == status.HTTP_200_OK, resp.content
        assert resp.data["kind"] == "collection"
        assert "/caldav/collection/" in resp.data["feed_url"]
        assert resp.data["can_manage"] is True

    def test_viewer_can_subscribe_but_not_manage(self):
        from guardian.shortcuts import assign_perm

        assign_perm("collections.view_collection", self.other, self.collection)
        self.client.force_authenticate(self.other)
        resp = self.client.get(self.url())
        assert resp.status_code == status.HTTP_200_OK, resp.content
        assert resp.data["can_manage"] is False
        # ...but cannot rotate the link.
        assert self.client.post(self.url()).status_code in (403, 404)

    def test_non_viewer_forbidden(self):
        self.client.force_authenticate(self.other)
        resp = self.client.get(self.url())
        assert resp.status_code in (403, 404)


class MyCalendarApiTests(TestCase):
    def setUp(self):
        self.user = UserFactory()
        self.client = APIClient()

    def test_get_returns_caldav_url(self):
        self.client.force_authenticate(self.user)
        resp = self.client.get("/api/my-calendar/")
        assert resp.status_code == status.HTTP_200_OK, resp.content
        assert resp.data["kind"] == "user"
        assert "/caldav/dav/" in resp.data["caldav_url"]

    def test_regenerate(self):
        self.client.force_authenticate(self.user)
        first = self.client.get("/api/my-calendar/").data["caldav_url"]
        second = self.client.post("/api/my-calendar/").data["caldav_url"]
        assert first != second

    def test_anonymous_unauthorized(self):
        resp = self.client.get("/api/my-calendar/")
        assert resp.status_code in (401, 403)
