"""API views for comments."""

from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, viewsets
from rest_framework.permissions import IsAuthenticatedOrReadOnly

from bubble.comments.api.permissions import IsAuthorOrReadOnly
from bubble.comments.api.serializers import CommentSerializer
from bubble.comments.models import Comment
from bubble.items.models import Item


class CommentViewSet(viewsets.ModelViewSet):
    """CRUD endpoint for item comments and ratings.

    - Anyone who can view an item can read its comments.
    - Authenticated users can post a comment (with an optional 1-5 rating).
    - Only the author can edit, and the author or item owner can delete.

    Filter the list by item with ``?item=<item_id>``.
    """

    serializer_class = CommentSerializer
    lookup_field = "id"
    permission_classes = [IsAuthenticatedOrReadOnly, IsAuthorOrReadOnly]

    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["item", "user", "rating"]
    ordering_fields = ["created_at", "rating"]
    ordering = ["-created_at"]

    def get_queryset(self):
        """Return comments on items the requester is allowed to view."""
        visible_items = Item.objects.visible_to(self.request.user)
        return Comment.objects.filter(item__in=visible_items).select_related(
            "user", "item"
        )

    def perform_create(self, serializer):
        """Attach the authenticated user as the comment author."""
        serializer.save(user=self.request.user)
