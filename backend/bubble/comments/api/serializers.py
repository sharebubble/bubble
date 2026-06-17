"""Serializers for the comments API."""

from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from bubble.comments.models import MAX_RATING, MIN_RATING, Comment
from bubble.items.models import Item


class CommentAuthorSerializer(serializers.Serializer):
    """Read-only minimal representation of a comment author."""

    id = serializers.UUIDField(read_only=True)
    username = serializers.CharField(read_only=True)
    name = serializers.CharField(read_only=True)


class CommentSerializer(serializers.ModelSerializer):
    """Serializer for Comment. The item is referenced by its UUID."""

    item = serializers.PrimaryKeyRelatedField(queryset=Item.objects.all())
    user = CommentAuthorSerializer(read_only=True)

    class Meta:
        model = Comment
        fields = [
            "id",
            "item",
            "user",
            "body",
            "rating",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "user", "created_at", "updated_at"]

    def validate_body(self, value):
        """Reject empty comments."""
        if not value or not value.strip():
            raise serializers.ValidationError(_("Comment must not be empty."))
        return value

    def validate_rating(self, value):
        """Ensure rating, when provided, is within the allowed range."""
        if value is not None and not (MIN_RATING <= value <= MAX_RATING):
            raise serializers.ValidationError(
                _("Rating must be between %(min)d and %(max)d.")
                % {"min": MIN_RATING, "max": MAX_RATING}
            )
        return value

    def validate_item(self, value):
        """Only allow commenting on items the requester is allowed to view."""
        request = self.context.get("request")
        user = request.user if request else None
        if not Item.objects.visible_to(user).filter(pk=value.pk).exists():
            raise serializers.ValidationError(_("You cannot comment on this item."))
        return value
