"""Tests for the comments API."""

# mypy: ignore-errors

from decimal import Decimal

from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from bubble.comments.models import Comment
from bubble.items.models import Item, ItemStatus, SalesType, VisibilityType
from bubble.items.tests.factories import ItemOwnerUserFactory

TEST_PASSWORD = "testpass123"  # noqa: S105


class CommentAPITestCase(TestCase):
    """Test cases for the comments API endpoints."""

    def setUp(self):
        self.client = APIClient()
        self.owner = ItemOwnerUserFactory(
            username="owner", email="owner@example.com", password=TEST_PASSWORD
        )
        self.commenter = ItemOwnerUserFactory(
            username="commenter", email="commenter@example.com", password=TEST_PASSWORD
        )
        self.other = ItemOwnerUserFactory(
            username="other", email="other@example.com", password=TEST_PASSWORD
        )

        self.item = Item.objects.create(
            name="Drill",
            description="A power drill",
            user=self.owner,
            sales_type=SalesType.RENT,
            price=Decimal("5.00"),
            status=ItemStatus.AVAILABLE,
            visibility=VisibilityType.PUBLIC,
        )

        self.list_url = reverse("api:comment-list")

    def _detail_url(self, comment):
        return reverse("api:comment-detail", kwargs={"id": comment.id})

    def test_authenticated_user_can_create_comment_with_rating(self):
        self.client.force_authenticate(user=self.commenter)
        response = self.client.post(
            self.list_url,
            {"item": str(self.item.id), "body": "Great drill!", "rating": 5},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        comment = Comment.objects.get()
        self.assertEqual(comment.user, self.commenter)
        self.assertEqual(comment.rating, 5)
        self.assertEqual(comment.item, self.item)

    def test_comment_without_rating_is_allowed(self):
        self.client.force_authenticate(user=self.commenter)
        response = self.client.post(
            self.list_url,
            {"item": str(self.item.id), "body": "Does it come with a battery?"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIsNone(Comment.objects.get().rating)

    def test_empty_body_is_rejected(self):
        self.client.force_authenticate(user=self.commenter)
        response = self.client.post(
            self.list_url,
            {"item": str(self.item.id), "body": "   ", "rating": 4},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invalid_rating_is_rejected(self):
        self.client.force_authenticate(user=self.commenter)
        response = self.client.post(
            self.list_url,
            {"item": str(self.item.id), "body": "Nice", "rating": 9},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_anonymous_user_cannot_create_comment(self):
        response = self.client.post(
            self.list_url,
            {"item": str(self.item.id), "body": "Hi", "rating": 3},
            format="json",
        )
        self.assertIn(
            response.status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )

    def test_list_comments_filtered_by_item(self):
        Comment.objects.create(item=self.item, user=self.commenter, body="A", rating=4)
        other_item = Item.objects.create(
            name="Saw",
            user=self.owner,
            sales_type=SalesType.SELL,
            price=Decimal("10.00"),
            status=ItemStatus.AVAILABLE,
            visibility=VisibilityType.PUBLIC,
        )
        Comment.objects.create(item=other_item, user=self.commenter, body="B")

        self.client.force_authenticate(user=self.commenter)
        response = self.client.get(self.list_url, {"item": str(self.item.id)})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["body"], "A")

    def test_author_can_update_own_comment(self):
        comment = Comment.objects.create(
            item=self.item, user=self.commenter, body="ok", rating=3
        )
        self.client.force_authenticate(user=self.commenter)
        response = self.client.patch(
            self._detail_url(comment), {"rating": 5}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        comment.refresh_from_db()
        self.assertEqual(comment.rating, 5)

    def test_item_cannot_be_changed_on_update(self):
        comment = Comment.objects.create(
            item=self.item, user=self.commenter, body="ok", rating=3
        )
        other_item = Item.objects.create(
            name="Saw",
            user=self.owner,
            sales_type=SalesType.SELL,
            price=Decimal("10.00"),
            status=ItemStatus.AVAILABLE,
            visibility=VisibilityType.PUBLIC,
        )
        self.client.force_authenticate(user=self.commenter)
        response = self.client.patch(
            self._detail_url(comment),
            {"item": str(other_item.id), "body": "edited"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        comment.refresh_from_db()
        # The item must stay pinned to the original; only the body changes.
        self.assertEqual(comment.item_id, self.item.id)
        self.assertEqual(comment.body, "edited")

    def test_non_author_cannot_update_comment(self):
        comment = Comment.objects.create(
            item=self.item, user=self.commenter, body="ok", rating=3
        )
        self.client.force_authenticate(user=self.other)
        response = self.client.patch(
            self._detail_url(comment), {"rating": 1}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_item_owner_can_delete_comment(self):
        comment = Comment.objects.create(
            item=self.item, user=self.commenter, body="ok", rating=3
        )
        self.client.force_authenticate(user=self.owner)
        response = self.client.delete(self._detail_url(comment))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Comment.objects.filter(id=comment.id).exists())

    def test_item_exposes_average_rating(self):
        Comment.objects.create(item=self.item, user=self.commenter, body="a", rating=4)
        Comment.objects.create(item=self.item, user=self.other, body="b", rating=2)

        self.client.force_authenticate(user=self.commenter)
        url = reverse("api:public-item-detail", kwargs={"id": self.item.id})
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["average_rating"], 3.0)
        self.assertEqual(response.data["rating_count"], 2)
        self.assertEqual(response.data["comment_count"], 2)
