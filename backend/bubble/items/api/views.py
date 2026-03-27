"""API views for items."""

import uuid as _uuid

from constance import config
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.base import ContentFile
from django.db import models
from django.shortcuts import get_object_or_404
from django.utils.translation import gettext_lazy as _
from django_filters.rest_framework import DjangoFilterBackend
from guardian.shortcuts import (
    assign_perm,
    get_groups_with_perms,
    get_objects_for_user,
    get_users_with_perms,
    remove_perm,
)
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import (
    DjangoModelPermissions,
    IsAuthenticatedOrReadOnly,
)
from rest_framework.response import Response

from bubble.items.ai.image_analyze import analyze_image
from bubble.items.ai.image_create import generate_image_from_prompt
from bubble.items.api.serializers import (
    ImageSerializer,
    ItemListSerializer,
    ItemSerializer,
)
from bubble.items.models import Image, Item, VisibilityType

from .filters import ItemFilter

User = get_user_model()


class ItemBaseViewSet(viewsets.GenericViewSet):
    """Base viewset with common settings for items."""

    lookup_field = "id"
    serializer_class = ItemListSerializer

    # Filtering / searching / ordering
    filterset_class = ItemFilter
    filter_backends = [
        DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    search_fields = ["name", "description"]
    ordering_fields = ["created_at", "updated_at", "price", "name"]
    ordering = ["-created_at"]

    def filter_queryset(self, queryset):
        """Apply filters, then fix price ordering so NULLs sort as < 0.

        Django/PostgreSQL places NULLs last on ASC and first on DESC by
        default. For price we want NULLs treated as lower than zero, i.e.:
          price ASC  → NULLs first, then 0, then positives
          price DESC → positives first, then 0, then NULLs last
        """
        queryset = super().filter_queryset(queryset)

        ordering = queryset.query.order_by
        if not ordering:
            return queryset

        new_ordering = []
        replaced = False
        for term in ordering:
            if term == "price":
                new_ordering.append(models.F("price").asc(nulls_first=True))
                replaced = True
            elif term == "-price":
                new_ordering.append(models.F("price").desc(nulls_last=True))
                replaced = True
            else:
                new_ordering.append(term)

        if replaced:
            queryset = queryset.order_by(*new_ordering)

        return queryset

    def get_serializer_class(self):
        """Return appropriate serializer class based on action."""
        if self.action in ("list", "my_items"):
            return ItemListSerializer
        return ItemSerializer


class PublicItemViewSet(viewsets.ReadOnlyModelViewSet, ItemBaseViewSet):
    """
    ViewSet for retrieving published items.
    This viewset is read-only and only returns items with a published status.

    Visibility rules:
    - PUBLIC (0): visible to everyone including anonymous users.
    - AUTHENTICATED (1): visible to any logged-in user.
    - SPECIFIC (2): visible only to users/groups explicitly granted view_item.
    - PRIVATE (3): visible only to the owner and co-owners (change_item holders).
    """

    permission_classes = [IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        user = self.request.user
        base_qs = (
            Item.objects.published().select_related("user").prefetch_related("images")
        )

        if not user.is_authenticated:
            if config.REQUIRE_LOGIN:
                # If login is required, anonymous users see nothing
                return base_qs.none()
            # Anonymous users: only PUBLIC items
            return base_qs.filter(visibility=VisibilityType.PUBLIC)

        # Items the user has explicit view permission on
        # (covers SPECIFIC + PRIVATE for co-owners/viewers)
        explicitly_visible = get_objects_for_user(
            user,
            "items.view_item",
            accept_global_perms=False,
        ).values_list("pk", flat=True)

        return base_qs.filter(
            # PUBLIC or AUTHENTICATED always visible
            models.Q(
                visibility__in=[VisibilityType.PUBLIC, VisibilityType.AUTHENTICATED]
            )
            # SPECIFIC: user must have explicit view_item
            | models.Q(visibility=VisibilityType.SPECIFIC, pk__in=explicitly_visible)
            # PRIVATE: owner + co-owners get view_item in Item.save()
            | models.Q(visibility=VisibilityType.PRIVATE, pk__in=explicitly_visible)
        )


class ItemViewSet(viewsets.ModelViewSet, ItemBaseViewSet):
    """
    ViewSet for retrieving, creating, updating, and deleting items.
    """

    def get_queryset(self):
        """Return items belonging to the authenticated user."""
        return (
            Item.objects.get_for_user(self.request.user)
            .select_related("user")
            .prefetch_related("images")
        )

    def perform_create(self, serializer):
        """Set the user when creating an item."""
        serializer.save(user=self.request.user)

    @action(detail=True, methods=["put"])
    def reorder_images(self, request, uuid=None):
        """Reorder images for an item."""
        item = self.get_object()

        image_order = request.data.get("image_order", [])

        if not isinstance(image_order, list):
            return Response({"error": "image_order must be a list"}, status=400)

        # Validate that all image UUIDs belong to this item
        item_image_uuids = {str(img.uuid) for img in item.images.all()}
        provided_image_uuids = {str(img_uuid) for img_uuid in image_order}

        if not provided_image_uuids.issubset(item_image_uuids):
            return Response({"error": "Invalid image UUIDs provided"}, status=400)

        # Update the ordering of each image
        for index, image_uuid in enumerate(image_order):
            Image.objects.filter(uuid=image_uuid, item=item).update(ordering=index)

        return Response({"success": True})

    @action(detail=True, methods=["put"])
    def ai_describe(self, request, *args, **kwargs):
        """Ai describe the item and populate fields."""
        item = self.get_object()

        first_image = item.get_first_image()
        if not first_image:
            raise ValidationError(_("Item has no images to analyze."))

        # Derive language from the Accept-Language header (first tag, e.g. "de" or "en")
        accept_language = request.headers.get("accept-language", "")
        language = accept_language.split(",")[0].split("-")[0].strip().lower() or "de"

        analyze_response = analyze_image(first_image.id, language=language)

        item.name = analyze_response.title
        item.description = analyze_response.description
        if analyze_response.category:
            item.category = analyze_response.category

        item.save()

        serializer = self.get_serializer(item)
        return Response(serializer.data)

    @action(detail=True, methods=["put"])
    def ai_image(self, request, uuid=None):
        """Generate an image from the item's name and description and attach it.

        The generated image is created by a small Google image model and saved
        as a new Image.original file for the item. Returns the created image
        data via ImageSerializer.
        """
        item = self.get_object()

        # Build prompt from name and description
        text_parts = []
        if item.name:
            text_parts.append(item.name)
        if item.description:
            text_parts.append(item.description)

        if not text_parts:
            return Response({"detail": "Item has no name or description."}, status=400)

        prompt = "\n\n".join(text_parts)

        image_bytes, _mime = generate_image_from_prompt(prompt)

        # Save the generated image as an Image instance
        filename = f"generated-{_uuid.uuid4().hex[:8]}.png"
        content = ContentFile(image_bytes, name=filename)
        Image.objects.create(item=item, original=content)

        serializer = self.get_serializer(item, context={"request": request})
        return Response(serializer.data)

    def _require_owner(self, item):
        """Raise PermissionDenied if the request user is not the item owner."""
        if item.user != self.request.user:
            raise PermissionDenied(
                _("Only the item owner can manage co-owners and viewers.")
            )

    @action(detail=True, methods=["get", "post", "delete"], url_path="co-owners")
    def co_owners(self, request, id=None):  # noqa: A002
        """
        Manage co-owners of an item.

        GET  — list current co-owners (users and groups with change_item).
        POST — grant co-ownership. Body: {"user": <id>} or {"group": <id>}.
        DELETE — revoke co-ownership. Body: {"user": <id>} or {"group": <id>}.

        Only the item owner can call this endpoint.
        Co-owners receive view_item + change_item. delete_item is never granted.
        """
        item = self.get_object()
        self._require_owner(item)

        if request.method == "GET":
            users = get_users_with_perms(
                item, attach_perms=True, with_group_users=False
            )
            groups = get_groups_with_perms(item, attach_perms=True)

            co_owner_users = [
                {"id": u.pk, "username": u.username}
                for u, perms in users.items()
                if "change_item" in perms and u != item.user
            ]
            co_owner_groups = [
                {"id": g.pk, "name": g.name}
                for g, perms in groups.items()
                if "change_item" in perms
            ]
            return Response({"users": co_owner_users, "groups": co_owner_groups})

        if request.method == "POST":
            user_id = request.data.get("user")
            group_id = request.data.get("group")
            if user_id:
                target = get_object_or_404(User, pk=user_id)
                assign_perm("items.view_item", target, item)
                assign_perm("items.change_item", target, item)
            elif group_id:
                target = get_object_or_404(Group, pk=group_id)
                assign_perm("items.view_item", target, item)
                assign_perm("items.change_item", target, item)
            else:
                raise ValidationError(_("Provide 'user' or 'group'."))
            return Response({"status": "co-owner granted"})

        if request.method == "DELETE":
            user_id = request.data.get("user")
            group_id = request.data.get("group")
            if user_id:
                target = get_object_or_404(User, pk=user_id)
                remove_perm("items.view_item", target, item)
                remove_perm("items.change_item", target, item)
            elif group_id:
                target = get_object_or_404(Group, pk=group_id)
                remove_perm("items.view_item", target, item)
                remove_perm("items.change_item", target, item)
            else:
                raise ValidationError(_("Provide 'user' or 'group'."))
            return Response({"status": "co-owner revoked"})

        return None

    @action(detail=True, methods=["get", "post", "delete"], url_path="viewers")
    def viewers(self, request, id=None):  # noqa: A002
        """
        Manage specific viewers of an item (SPECIFIC visibility).

        GET  — list users and groups with view_item but NOT change_item.
        POST — grant view_item only. Body: {"user": <id>} or {"group": <id>}.
        DELETE — revoke view_item. Body: {"user": <id>} or {"group": <id>}.

        Only the item owner can call this endpoint.
        """
        item = self.get_object()
        self._require_owner(item)

        if request.method == "GET":
            users = get_users_with_perms(
                item, attach_perms=True, with_group_users=False
            )
            groups = get_groups_with_perms(item, attach_perms=True)

            viewer_users = [
                {"id": u.pk, "username": u.username}
                for u, perms in users.items()
                if "view_item" in perms
                and "change_item" not in perms
                and u != item.user
            ]
            viewer_groups = [
                {"id": g.pk, "name": g.name}
                for g, perms in groups.items()
                if "view_item" in perms and "change_item" not in perms
            ]
            return Response({"users": viewer_users, "groups": viewer_groups})

        if request.method == "POST":
            user_id = request.data.get("user")
            group_id = request.data.get("group")
            if user_id:
                target = get_object_or_404(User, pk=user_id)
                assign_perm("items.view_item", target, item)
            elif group_id:
                target = get_object_or_404(Group, pk=group_id)
                assign_perm("items.view_item", target, item)
            else:
                raise ValidationError(_("Provide 'user' or 'group'."))
            return Response({"status": "viewer granted"})

        if request.method == "DELETE":
            user_id = request.data.get("user")
            group_id = request.data.get("group")
            if user_id:
                target = get_object_or_404(User, pk=user_id)
                remove_perm("items.view_item", target, item)
            elif group_id:
                target = get_object_or_404(Group, pk=group_id)
                remove_perm("items.view_item", target, item)
            else:
                raise ValidationError(_("Provide 'user' or 'group'."))
            return Response({"status": "viewer revoked"})

        return None


class ImageViewSet(viewsets.ModelViewSet):
    """
    ViewSet for retrieving images.
    Only authenticated users can access images.
    Users can only see images of items they have access to.
    """

    serializer_class = ImageSerializer
    lookup_field = "id"
    ordering = ["item", "ordering"]

    # we can use generic permissions here as the queryset limits strictly
    # to only editable items for the user
    permission_classes = [DjangoModelPermissions]

    def get_queryset(self):
        """Return images that the user can access."""
        queryset = Image.objects.filter(
            item_id__in=Item.objects.get_for_user(self.request.user).values_list(
                "pk", flat=True
            )
        )

        # Filter by item if specified
        item_id = self.request.query_params.get("item")
        if item_id is not None:
            queryset = queryset.filter(item__id=item_id)

        return queryset

    def perform_create(self, serializer):
        """Set ordering automatically if not provided."""
        # If ordering is not provided, set it based on existing images count
        ordering = serializer.validated_data.get("ordering")
        if "ordering" not in serializer.validated_data or ordering is None:
            item = serializer.validated_data.get("item")
            if item:
                # Get the count of existing images for this item
                existing_count = Image.objects.filter(item=item).count()
                serializer.save(ordering=existing_count)
                return

        serializer.save()
