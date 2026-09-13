"""Serializers for the item favorites API."""

from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from bubble.favorites.models import FavoriteItem
from bubble.items.api.serializers import ItemListSerializer
from bubble.items.models import Item


class FavoriteItemSerializer(serializers.ModelSerializer):
    """A favorite, with the marked item inlined for list rendering.

    ``item`` is the writable side (an item id); ``item_detail`` carries the
    fields the item cards need, so the favorites list renders without a second
    round trip per entry.
    """

    item = serializers.PrimaryKeyRelatedField(queryset=Item.objects.all())
    item_detail = ItemListSerializer(source="item", read_only=True)

    class Meta:
        model = FavoriteItem
        fields = ["id", "item", "item_detail", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate_item(self, value):
        """Reject items the requesting user is not allowed to see."""
        user = self.context["request"].user
        if not Item.objects.visible_to(user).filter(pk=value.pk).exists():
            message = _("You cannot favorite an item you are not allowed to see.")
            raise serializers.ValidationError(message)
        return value


class FavoriteItemIdsSerializer(serializers.Serializer):
    """The ids of every item the current user has marked as favorite."""

    item_ids = serializers.ListField(child=serializers.UUIDField())
