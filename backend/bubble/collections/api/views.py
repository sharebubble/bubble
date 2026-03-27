"""API views for collections."""

import uuid

from django.db import transaction
from django.db.models import Count
from django.utils.translation import gettext_lazy as _
from drf_spectacular.utils import extend_schema
from guardian.shortcuts import get_objects_for_user
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from bubble.collections.api.permissions import (
    CanManagePermissions,
    CollectionItemObjectPermission,
    CollectionObjectPermission,
)
from bubble.collections.api.serializers import (
    CollectionEventSerializer,
    CollectionGrantSerializer,
    CollectionItemSerializer,
    CollectionListSerializer,
    CollectionPermissionSerializer,
    CollectionSerializer,
    codenames_to_role,
)
from bubble.collections.models import (
    Collection,
    CollectionEvent,
    CollectionGroupObjectPermission,
    CollectionItem,
    CollectionUserObjectPermission,
)
from bubble.items.models import Item


class CollectionViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing collections.

    Provides CRUD operations for collections with object-level permissions.
    """

    lookup_field = "pk"
    permission_classes = [IsAuthenticated, CollectionObjectPermission]

    def get_queryset(self):
        """Return collections the user has permission to view."""
        return Collection.objects.get_for_user(self.request.user).annotate(
            annotated_items_count=Count("items", distinct=True)
        )

    def get_serializer_class(self):
        """Return appropriate serializer class based on action."""
        if self.action == "list":
            return CollectionListSerializer
        return CollectionSerializer

    def perform_create(self, serializer):
        """Set the owner to the current user."""
        serializer.save(owner=self.request.user)

    @action(detail=True, methods=["post"], url_path="add-item")
    def add_item(self, request, pk=None):
        """Add an item to the collection."""
        collection = self.get_object()

        serializer = CollectionItemSerializer(
            data={**request.data, "collection": collection.id},
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)

        try:
            with transaction.atomic():
                item = Item.objects.get(pk=serializer.validated_data["item_id"])
                collection_item = CollectionItem.objects.create(
                    collection=collection,
                    item=item,
                    added_by=request.user,
                    note=serializer.validated_data.get("note", ""),
                    ordering=serializer.validated_data.get("ordering", 0),
                )
                CollectionEvent.objects.create(
                    collection=collection,
                    item=item,
                    item_name=item.name,
                    actor=request.user,
                    action=CollectionEvent.Action.ITEM_ADDED,
                )
        except Item.DoesNotExist:
            return Response(
                {"error": _("Item not found")},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(
            CollectionItemSerializer(
                collection_item, context={"request": request}
            ).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="bulk-add-items")
    def bulk_add_items(self, request, pk=None):
        """Add multiple items to the collection."""
        collection = self.get_object()
        item_ids = request.data.get("item_ids", [])

        if not isinstance(item_ids, list):
            return Response(
                {"error": _("item_ids must be a list")},
                status=status.HTTP_400_BAD_REQUEST,
            )

        viewable_item_ids = set(
            get_objects_for_user(
                request.user, "items.view_item", klass=Item, accept_global_perms=False
            ).values_list("pk", flat=True)
        )

        added_items = []
        errors = []

        with transaction.atomic():
            for item_id in item_ids:
                try:
                    parsed_id = uuid.UUID(str(item_id))
                except (ValueError, AttributeError):
                    errors.append({"item_id": item_id, "error": _("Invalid item ID")})
                    continue

                if parsed_id not in viewable_item_ids:
                    errors.append(
                        {
                            "item_id": item_id,
                            "error": _("Item not found or not accessible"),
                        }
                    )
                    continue

                try:
                    item = Item.objects.get(pk=parsed_id)
                    if CollectionItem.objects.filter(
                        collection=collection, item=item
                    ).exists():
                        errors.append(
                            {
                                "item_id": item_id,
                                "error": _("Item already in collection"),
                            }
                        )
                        continue

                    collection_item = CollectionItem.objects.create(
                        collection=collection,
                        item=item,
                        added_by=request.user,
                    )
                    added_items.append(collection_item)
                    CollectionEvent.objects.create(
                        collection=collection,
                        item=item,
                        item_name=item.name,
                        actor=request.user,
                        action=CollectionEvent.Action.ITEM_ADDED,
                    )
                except Item.DoesNotExist:
                    errors.append({"item_id": item_id, "error": _("Item not found")})

        return Response(
            {
                "added": CollectionItemSerializer(
                    added_items, many=True, context={"request": request}
                ).data,
                "errors": errors,
            },
            status=status.HTTP_201_CREATED
            if added_items
            else status.HTTP_400_BAD_REQUEST,
        )

    @action(
        detail=True,
        methods=["post"],
        url_path="remove-item/(?P<item_id>[^/.]+)",
    )
    def remove_item(self, request, pk=None, item_id=None):
        """Remove an item from the collection."""
        collection = self.get_object()

        try:
            collection_item = CollectionItem.objects.select_related("item").get(
                collection=collection, item_id=item_id
            )
            item = collection_item.item
            with transaction.atomic():
                CollectionEvent.objects.create(
                    collection=collection,
                    item=item,
                    item_name=item.name,
                    actor=request.user,
                    action=CollectionEvent.Action.ITEM_REMOVED,
                )
                collection_item.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        except CollectionItem.DoesNotExist:
            return Response(
                {"error": _("Item not found in collection")},
                status=status.HTTP_404_NOT_FOUND,
            )

    @action(detail=True, methods=["post"], url_path="bulk-remove-items")
    def bulk_remove_items(self, request, pk=None):
        """Remove multiple items from the collection."""
        collection = self.get_object()
        item_ids = request.data.get("item_ids", [])

        if not isinstance(item_ids, list):
            return Response(
                {"error": _("item_ids must be a list")},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            items_to_remove = CollectionItem.objects.filter(
                collection=collection, item_id__in=item_ids
            ).select_related("item")
            events = [
                CollectionEvent(
                    collection=collection,
                    item=ci.item,
                    item_name=ci.item.name,
                    actor=request.user,
                    action=CollectionEvent.Action.ITEM_REMOVED,
                )
                for ci in items_to_remove
            ]
            CollectionEvent.objects.bulk_create(events)
            deleted_count = items_to_remove.delete()[0]

        return Response({"deleted_count": deleted_count}, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsAuthenticated, CanManagePermissions],
    )
    def manage_permissions(self, request, pk=None):
        """
        Manage permissions for a collection.

        Only the owner can manage permissions.
        """
        collection = self.get_object()
        serializer = CollectionPermissionSerializer(
            data=request.data, context={"collection": collection}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save(collection)

        return Response(
            {"message": _("Permission updated successfully")},
            status=status.HTTP_200_OK,
        )

    @extend_schema(responses=CollectionGrantSerializer(many=True))
    @action(
        detail=True,
        methods=["get"],
        permission_classes=[IsAuthenticated, CanManagePermissions],
        url_path="permissions",
    )
    def list_permissions(self, request, pk=None, **kwargs):
        """Return all current permission grants for a collection (owner only).

        Returns one entry per subject with a computed role name.
        """
        collection = self.get_object()

        # Collect all raw grants grouped by (subject_type, subject_id)
        subject_codenames: dict[tuple[str, str], dict] = {}

        user_grants = CollectionUserObjectPermission.objects.filter(
            content_object=collection
        ).select_related("user", "permission")
        for grant in user_grants:
            key = ("user", str(grant.user.pk))
            if key not in subject_codenames:
                subject_codenames[key] = {
                    "subject_type": "user",
                    "subject_id": str(grant.user.pk),
                    "subject_name": grant.user.username,
                    "codenames": set(),
                }
            subject_codenames[key]["codenames"].add(grant.permission.codename)

        group_grants = CollectionGroupObjectPermission.objects.filter(
            content_object=collection
        ).select_related("group", "permission")
        for grant in group_grants:
            key = ("group", str(grant.group.pk))
            if key not in subject_codenames:
                subject_codenames[key] = {
                    "subject_type": "group",
                    "subject_id": str(grant.group.pk),
                    "subject_name": grant.group.name,
                    "codenames": set(),
                }
            subject_codenames[key]["codenames"].add(grant.permission.codename)

        # Build aggregated list with computed role
        aggregated = [
            {
                "subject_type": data["subject_type"],
                "subject_id": data["subject_id"],
                "subject_name": data["subject_name"],
                "role": codenames_to_role(data["codenames"]),
            }
            for data in subject_codenames.values()
        ]

        serializer = CollectionGrantSerializer(aggregated, many=True)
        return Response(serializer.data)

    @extend_schema(responses=CollectionListSerializer(many=True))
    @action(
        detail=False,
        methods=["get"],
        url_path=r"for-item/(?P<item_id>[^/.]+)",
    )
    def for_item(self, request, item_id=None):
        """Return all collections visible to the current user that contain the item."""
        collections = self.get_queryset().filter(items__id=item_id)
        serializer = CollectionListSerializer(
            collections, many=True, context={"request": request}
        )
        return Response(serializer.data)

    @extend_schema(responses=CollectionListSerializer(many=True))
    @action(detail=False, methods=["get"], url_path="my-collections")
    def my_collections(self, request):
        """Get all collections owned by the current user."""
        collections = Collection.objects.filter(owner=request.user).annotate(
            annotated_items_count=Count("items", distinct=True)
        )
        serializer = CollectionListSerializer(
            collections, many=True, context={"request": request}
        )
        return Response(serializer.data)

    @extend_schema(responses=CollectionEventSerializer(many=True))
    @action(detail=True, methods=["get"], url_path="history")
    def history(self, request, pk=None):
        """Return full event history for a collection (no pagination)."""
        collection = self.get_object()
        events = CollectionEvent.objects.filter(collection=collection).select_related(
            "item", "actor"
        )
        serializer = CollectionEventSerializer(events, many=True)
        return Response(serializer.data)


class CollectionItemViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing items within collections.

    Provides CRUD operations for collection items.
    """

    lookup_field = "pk"
    serializer_class = CollectionItemSerializer

    def get_permissions(self):
        """Return appropriate permissions based on action."""
        if self.action in ["update", "partial_update", "destroy"]:
            return [IsAuthenticated(), CollectionItemObjectPermission()]
        return [IsAuthenticated()]

    def get_queryset(self):
        """Return collection items the user has permission to view."""
        viewable_collections = Collection.objects.get_for_user(self.request.user)
        return CollectionItem.objects.filter(collection__in=viewable_collections)

    def perform_create(self, serializer):
        """Set the added_by to the current user."""
        collection = serializer.validated_data["collection"]
        if not self.request.user.has_perm("collections.add_items", collection):
            raise PermissionDenied(
                _("You don't have permission to add items to this collection")
            )

        item = Item.objects.get(pk=serializer.validated_data["item_id"])
        serializer.save(added_by=self.request.user, item=item)
