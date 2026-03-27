"""Serializers for collections API."""

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.utils.translation import gettext_lazy as _
from guardian.shortcuts import assign_perm, get_objects_for_user, remove_perm
from rest_framework import serializers

from bubble.collections.models import Collection, CollectionEvent, CollectionItem
from bubble.items.api.serializers import ItemMinimalSerializer
from bubble.items.models import Item, VisibilityType

User = get_user_model()


ALL_CODENAMES = [
    "view_collection",
    "change_collection",
    "delete_collection",
    "add_items",
    "remove_items",
]

ROLE_CODENAMES: dict[str, list[str]] = {
    "view": ["view_collection"],
    "edit": ["view_collection", "add_items", "remove_items"],
    "owner": [
        "view_collection",
        "change_collection",
        "delete_collection",
        "add_items",
        "remove_items",
    ],
}

# Reverse map: frozenset of codenames → role name
_CODENAME_SET_TO_ROLE: dict[frozenset, str] = {
    frozenset(v): k for k, v in ROLE_CODENAMES.items()
}


def codenames_to_role(codenames: set[str]) -> str:
    """Map a set of codenames to the matching role name, or 'custom' if no match."""
    return _CODENAME_SET_TO_ROLE.get(frozenset(codenames), "custom")


class CollectionGrantSerializer(serializers.Serializer):
    """Read-only serializer for a single aggregated permission grant on a collection.

    Expects pre-aggregated dicts with keys:
      subject_type, subject_id, subject_name, role
    """

    subject_type = serializers.CharField()
    subject_id = serializers.CharField()
    subject_name = serializers.CharField()
    permission = serializers.CharField(source="role")


class CollectionItemSerializer(serializers.ModelSerializer):
    """Serializer for CollectionItem model."""

    item = ItemMinimalSerializer(read_only=True)
    item_id = serializers.UUIDField(write_only=True)
    collection = serializers.PrimaryKeyRelatedField(queryset=Collection.objects.all())
    added_by = serializers.StringRelatedField(read_only=True)

    class Meta:
        model = CollectionItem
        fields = [
            "id",
            "collection",
            "item",
            "item_id",
            "added_at",
            "added_by",
            "note",
            "ordering",
        ]
        read_only_fields = ["id", "added_at", "added_by"]

    def validate_item_id(self, value):
        """Ensure the requesting user can view the item being added.

        An item is considered viewable if:
        - its visibility is PUBLIC or AUTHENTICATED (any logged-in user may see it), or
        - the user holds an explicit object-level ``view_item`` guardian permission
          on it (covers SPECIFIC and PRIVATE visibility).
        """
        request = self.context.get("request")
        if request and request.user:
            # Items with open visibility are accessible to all authenticated users
            # without an explicit guardian grant — mirror PublicItemViewSet logic.
            open_visibilities = [VisibilityType.PUBLIC, VisibilityType.AUTHENTICATED]
            if Item.objects.filter(pk=value, visibility__in=open_visibilities).exists():
                return value

            # For SPECIFIC / PRIVATE items fall back to object-level guardian check.
            explicitly_viewable = get_objects_for_user(
                request.user, "items.view_item", accept_global_perms=False
            )
            if not explicitly_viewable.filter(pk=value).exists():
                raise serializers.ValidationError(
                    _("You don't have permission to add this item.")
                )
        return value

    def validate(self, attrs):
        """Reject the addition if the item is already present in the collection."""
        collection = attrs.get("collection")
        item_id = attrs.get("item_id")
        if collection is not None and item_id is not None:
            if CollectionItem.objects.filter(
                collection=collection, item_id=item_id
            ).exists():
                raise serializers.ValidationError(
                    {"item_id": _("This item is already in the collection.")}
                )
        return attrs


class CollectionSerializer(serializers.ModelSerializer):
    """Serializer for Collection model."""

    owner = serializers.StringRelatedField(read_only=True)
    items_count = serializers.SerializerMethodField()
    collection_items = CollectionItemSerializer(many=True, read_only=True)
    can_remove_items = serializers.SerializerMethodField()

    class Meta:
        model = Collection
        fields = [
            "id",
            "name",
            "description",
            "owner",
            "items_count",
            "can_remove_items",
            "collection_items",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "owner", "created_at", "updated_at"]

    def get_items_count(self, obj):
        """Get the number of items in the collection."""
        if hasattr(obj, "annotated_items_count"):
            return obj.annotated_items_count
        return obj.items.count()

    def get_can_remove_items(self, obj):
        """Return True if the requesting user has the remove_items permission."""
        request = self.context.get("request")
        if request and request.user and request.user.is_authenticated:
            return request.user.has_perm("collections.remove_items", obj)
        return False


class CollectionListSerializer(CollectionSerializer):
    """Lightweight serializer for collection lists."""

    collection_items = None
    can_add_items = serializers.SerializerMethodField()

    class Meta(CollectionSerializer.Meta):
        fields = [
            "id",
            "name",
            "description",
            "owner",
            "items_count",
            "can_add_items",
            "created_at",
            "updated_at",
        ]

    def get_can_add_items(self, obj):
        """Return True if the requesting user has the add_items permission"""
        request = self.context.get("request")
        if request and request.user and request.user.is_authenticated:
            return request.user.has_perm("collections.add_items", obj)
        return False


class CollectionPermissionSerializer(serializers.Serializer):
    """Serializer for managing collection permissions via named roles.

    Roles:
      view  — grants view_collection
      edit  — grants view_collection + add_items + remove_items
      owner — grants all five codenames

    On grant: revokes all codenames first (clean slate), then grants the role set.
    On revoke: revokes all codenames (full removal regardless of role argument).
    """

    user_id = serializers.UUIDField(required=False, allow_null=True)
    group_id = serializers.IntegerField(required=False, allow_null=True)
    role = serializers.ChoiceField(choices=["view", "edit", "owner"])
    action = serializers.ChoiceField(choices=["grant", "revoke"])

    def validate(self, attrs):
        """Ensure either user_id or group_id is provided, but not both.

        Also blocks revoking the owner role from the collection's original creator.
        """
        user_id = attrs.get("user_id")
        group_id = attrs.get("group_id")

        if not user_id and not group_id:
            raise serializers.ValidationError(
                _("Either user_id or group_id must be provided.")
            )

        if user_id and group_id:
            raise serializers.ValidationError(
                _("Cannot specify both user_id and group_id.")
            )

        # Validate user exists
        if user_id:
            try:
                User.objects.get(pk=user_id)
            except User.DoesNotExist as e:
                raise serializers.ValidationError(
                    {"user_id": _("User not found.")}
                ) from e

        # Validate group exists
        if group_id:
            try:
                Group.objects.get(pk=group_id)
            except Group.DoesNotExist as e:
                raise serializers.ValidationError(
                    {"group_id": _("Group not found.")}
                ) from e

        # Prevent removing owner permissions from the collection's original creator.
        collection = self.context.get("collection")
        if (
            collection is not None
            and attrs.get("action") == "revoke"
            and user_id is not None
            and str(collection.owner_id) == str(user_id)
        ):
            raise serializers.ValidationError(
                _("Cannot remove owner permissions from the collection creator.")
            )

        return attrs

    def save(self, collection):
        """Apply the role grant or full revocation."""
        user_id = self.validated_data.get("user_id")
        group_id = self.validated_data.get("group_id")
        role = self.validated_data["role"]
        action = self.validated_data["action"]

        if user_id:
            subject = User.objects.get(pk=user_id)
        else:
            subject = Group.objects.get(pk=group_id)

        # Always revoke all codenames first (clean slate)
        for codename in ALL_CODENAMES:
            remove_perm(f"collections.{codename}", subject, collection)

        if action == "grant":
            for codename in ROLE_CODENAMES[role]:
                assign_perm(f"collections.{codename}", subject, collection)

        return collection


class CollectionEventSerializer(serializers.ModelSerializer):
    """Read-only serializer for CollectionEvent audit log entries."""

    actor = serializers.StringRelatedField(read_only=True)
    item_id = serializers.PrimaryKeyRelatedField(source="item", read_only=True)

    class Meta:
        model = CollectionEvent
        fields = [
            "id",
            "item_id",
            "item_name",
            "actor",
            "action",
            "timestamp",
        ]
        read_only_fields = fields
