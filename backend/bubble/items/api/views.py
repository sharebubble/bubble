"""API views for items."""

import io
import uuid as _uuid
from pathlib import Path

from constance import config
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.base import ContentFile
from django.db import models
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils.translation import gettext_lazy as _
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import extend_schema
from guardian.shortcuts import (
    assign_perm,
    get_groups_with_perms,
    get_objects_for_user,
    get_users_with_perms,
    remove_perm,
)
from PIL import Image as PILImage
from PIL import ImageOps as PILImageOps
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import (
    DjangoModelPermissions,
    IsAuthenticated,
    IsAuthenticatedOrReadOnly,
)
from rest_framework.response import Response

from bubble.bookings.api.serializers import ItemBookingHistorySerializer
from bubble.bookings.models import Booking, BookingStatus
from bubble.collections.models import Collection
from bubble.core.storage import absolute_media_url
from bubble.federation.models import RemoteItem
from bubble.items.ai.image_analyze import analyze_image
from bubble.items.ai.image_create import generate_image_from_prompt
from bubble.items.api.search import (
    RelevanceOrderingFilter,
    parse_search_query,
    relevance_score,
    search_filter_q,
)
from bubble.items.api.serializers import (
    ImageSerializer,
    ItemListSerializer,
    ItemSerializer,
    LocationSerializer,
)
from bubble.items.models import (
    Image,
    Item,
    ItemStatus,
    Location,
    SalesType,
    VisibilityType,
)

from .filters import ItemFilter

User = get_user_model()


def annotate_comment_stats(queryset):
    """Annotate items with aggregate comment/rating statistics.

    Adds ``_avg_rating``, ``_rating_count`` and ``_comment_count`` so the item
    serializers can expose ratings without triggering per-item queries.
    """
    return queryset.annotate(
        _avg_rating=models.Avg("comments__rating"),
        _rating_count=models.Count(
            "comments", filter=models.Q(comments__rating__isnull=False)
        ),
        _comment_count=models.Count("comments", distinct=True),
    )


class ItemBaseViewSet(viewsets.GenericViewSet):
    """Base viewset with common settings for items."""

    lookup_field = "id"
    serializer_class = ItemListSerializer

    # Filtering / searching / ordering.
    # Free-text search lives in `ItemFilter.search` (ranked, title-first)
    # rather than DRF's SearchFilter, which would apply a second, unranked
    # pass over the same `search` query parameter.
    filterset_class = ItemFilter
    filter_backends = [
        DjangoFilterBackend,
        RelevanceOrderingFilter,
    ]
    ordering_fields = ["created_at", "updated_at", "price", "name", "relevance"]
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


# Availability facet value → the item statuses it maps to. Sold items are no
# longer browsable, so there is no "sold" facet to offer.
AVAILABILITY_STATUSES = {
    "available": [ItemStatus.AVAILABLE, ItemStatus.RESERVED],
    "rented": [ItemStatus.RENTED],
}

# Type facet value → the sales types it maps to.
TYPE_SALES_TYPES = {
    "rent": [SalesType.RENT, SalesType.BORROW],
    "buy": [SalesType.SELL, SalesType.DONATE],
    "wanted": [SalesType.WANT_BUY, SalesType.WANT_RENT],
}


class CategoryFacetSerializer(serializers.Serializer):
    """A category and the number of matching visible items."""

    category = serializers.CharField()
    count = serializers.IntegerField()


class CollectionFacetSerializer(serializers.Serializer):
    """A collection and the number of matching visible items it contains."""

    id = serializers.CharField()
    name = serializers.CharField()
    owner = serializers.CharField()
    count = serializers.IntegerField()


class OwnerFacetSerializer(serializers.Serializer):
    """An owner and the number of their matching visible items."""

    id = serializers.CharField()
    username = serializers.CharField()
    name = serializers.CharField(allow_blank=True)
    count = serializers.IntegerField()


class AvailabilityFacetSerializer(serializers.Serializer):
    """An availability value and the number of matching visible items."""

    value = serializers.CharField()
    count = serializers.IntegerField()


class TypeFacetSerializer(serializers.Serializer):
    """A type value (rent | buy | wanted) and its matching visible item count."""

    value = serializers.CharField()
    count = serializers.IntegerField()


class SearchFacetsSerializer(serializers.Serializer):
    """The full set of search facets, each excluding its own active filter."""

    types = TypeFacetSerializer(many=True)
    categories = CategoryFacetSerializer(many=True)
    collections = CollectionFacetSerializer(many=True)
    availability = AvailabilityFacetSerializer(many=True)
    owners = OwnerFacetSerializer(many=True)


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
        base_qs = annotate_comment_stats(
            Item.objects.published()
            .select_related("user", "location")
            .prefetch_related("images")
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

    @staticmethod
    def _as_uuid(value):
        """Return value if it is a valid UUID string, otherwise None."""
        if not value:
            return None
        try:
            _uuid.UUID(str(value))
        except (ValueError, TypeError, AttributeError):
            return None
        return value

    @extend_schema(responses=SearchFacetsSerializer)
    @action(detail=False, methods=["get"])
    def facets(self, request):
        """Return the search facets, cross-filtered by the active selection.

        Powers the header search popup. Each facet (type, category, collection,
        availability, owner) is computed over the visible items narrowed by
        every *other* active filter, but never by the facet's own dimension —
        so picking a collection updates the types/categories/owners/availability
        on offer (and their counts) while still letting you switch collection.
        """
        category = request.query_params.get("category") or None
        collection = self._as_uuid(request.query_params.get("collection"))
        owner = self._as_uuid(
            request.query_params.get("owner") or request.query_params.get("user")
        )
        availability = request.query_params.get("availability") or None
        type_ = request.query_params.get("type") or None
        # Parsed with the same rules as the item list, so a facet count never
        # promises more (or fewer) results than the list actually returns.
        search_query = parse_search_query(request.query_params.get("search"))

        base = self.get_queryset()

        def narrowed(exclude: str):
            """Visible items filtered by every active filter except ``exclude``."""
            qs = base
            if type_ and exclude != "type":
                qs = qs.filter(sales_type__in=TYPE_SALES_TYPES.get(type_, []))
            if category and exclude != "category":
                qs = qs.filter(category=category)
            if collection and exclude != "collection":
                qs = qs.filter(collections__id=collection)
            if owner and exclude != "owner":
                qs = qs.filter(user_id=owner)
            if availability and exclude != "availability":
                qs = qs.filter(status__in=AVAILABILITY_STATUSES.get(availability, []))
            if search_query:
                qs = qs.filter(search_filter_q(search_query))
            return qs

        count = models.Count("id", distinct=True)

        # Count every type preset in a single query via conditional aggregation
        # instead of one COUNT(*) per preset.
        type_base = narrowed("type")
        type_counts = type_base.aggregate(
            **{
                value: models.Count(
                    "id", filter=models.Q(sales_type__in=sales_types), distinct=True
                )
                for value, sales_types in TYPE_SALES_TYPES.items()
            }
        )
        types = [
            {"value": value, "count": type_counts[value]}
            for value in TYPE_SALES_TYPES
            if type_counts[value]
        ]

        categories = [
            {"category": row["category"], "count": row["count"]}
            for row in narrowed("category")
            .exclude(category="")
            .values("category")
            .annotate(count=count)
            .order_by("category")
        ]

        viewable_collections = Collection.objects.get_for_user(
            request.user
        ).values_list("id", flat=True)
        collections = [
            {
                "id": str(row["collections__id"]),
                "name": row["collections__name"],
                "owner": row["collections__owner__username"],
                "count": row["count"],
            }
            for row in narrowed("collection")
            .filter(collections__id__in=viewable_collections)
            .values(
                "collections__id",
                "collections__name",
                "collections__owner__username",
            )
            .annotate(count=count)
            .order_by("collections__name")
        ]

        owners = [
            {
                "id": str(row["user__id"]),
                "username": row["user__username"],
                "name": row["user__name"] or "",
                "count": row["count"],
            }
            for row in narrowed("owner")
            .values("user__id", "user__username", "user__name")
            .annotate(count=count)
            .order_by("user__username")
        ]

        # Same single-query conditional aggregation for the availability presets.
        availability_base = narrowed("availability")
        availability_counts = availability_base.aggregate(
            **{
                value: models.Count(
                    "id", filter=models.Q(status__in=statuses), distinct=True
                )
                for value, statuses in AVAILABILITY_STATUSES.items()
            }
        )
        availability_facets = [
            {"value": value, "count": availability_counts[value]}
            for value in AVAILABILITY_STATUSES
            if availability_counts[value]
        ]

        data = {
            "types": types,
            "categories": categories,
            "collections": collections,
            "availability": availability_facets,
            "owners": owners,
        }
        return Response(SearchFacetsSerializer(data).data)

    @action(detail=True, methods=["get"], url_path="booking-history")
    def booking_history(self, request, id=None):  # noqa: A002
        """Return the item's historical bookings (confirmed + completed).

        Only booking information is exposed — never message/conversation data.
        Access follows the item's own visibility (enforced by get_object), and
        booker names are only included for authenticated viewers.
        """
        item = self.get_object()
        bookings = (
            Booking.objects.filter(
                item=item,
                status__in=[BookingStatus.CONFIRMED, BookingStatus.COMPLETED],
            )
            .select_related("item", "user", "remote_booker_actor")
            .order_by("-time_from", "-created_at")
        )
        serializer = ItemBookingHistorySerializer(
            bookings, many=True, context={"request": request}
        )
        return Response(serializer.data)


class ItemViewSet(viewsets.ModelViewSet, ItemBaseViewSet):
    """
    ViewSet for retrieving, creating, updating, and deleting items.
    """

    def get_queryset(self):
        """Return items belonging to the authenticated user."""
        return annotate_comment_stats(
            Item.objects.get_for_user(self.request.user)
            .select_related("user", "location")
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

    @extend_schema(request=None)
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

    @extend_schema(request=None)
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


class LocationViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only list of item placements (library shelves, shared areas, ...).

    Any authenticated user can browse locations in order to pick one when
    editing an item.  Pass ``?item_category=<category>`` to get only the
    locations that apply to that category plus the category-agnostic ones
    (those with a blank ``item_category``).  Curators manage the list itself
    through the Django admin.
    """

    serializer_class = LocationSerializer
    lookup_field = "id"
    permission_classes = [IsAuthenticated]
    queryset = Location.objects.all()

    def get_queryset(self):
        queryset = super().get_queryset()
        item_category = self.request.query_params.get("item_category")
        if item_category:
            queryset = queryset.filter(
                Q(item_category=item_category) | Q(item_category="")
            )
        return queryset


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

    @action(detail=True, methods=["put"], url_path="rotate")
    def rotate(self, request, id=None):  # noqa: A002
        """Rotate the original image 90° left or right and regenerate thumbnails."""
        image = self.get_object()
        direction = request.data.get("direction", "right")
        if direction not in ("left", "right"):
            return Response(
                {"detail": "direction must be 'left' or 'right'"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # PIL rotates counter-clockwise; expand=True preserves dimensions after rotation
        angle = 90 if direction == "left" else -90

        with image.original.open("rb") as f:
            pil_img = PILImage.open(f)
            pil_img.load()
            original_format = pil_img.format or "JPEG"
            # Normalise EXIF orientation into pixels before rotating so the result
            # matches what the user sees visually (imagekit does the same for
            # thumbnails).
            pil_img = PILImageOps.exif_transpose(pil_img)
            rotated = pil_img.rotate(angle, expand=True)

        buffer = io.BytesIO()
        save_format = (
            original_format if original_format in ("JPEG", "PNG", "WEBP") else "JPEG"
        )
        save_kwargs = {"quality": 95} if save_format in ("JPEG", "WEBP") else {}
        if save_format == "JPEG" and rotated.mode in ("RGBA", "LA", "P"):
            rotated = rotated.convert("RGB")
        rotated.save(buffer, format=save_format, **save_kwargs)
        buffer.seek(0)

        # Save under a new path via FieldFile.save() so the model is updated in the DB
        # and all derived URLs (original, thumbnail, preview) change — guaranteeing
        # browsers and CDNs fetch fresh content rather than serving a cached version.
        old_name = image.original.name
        extension = Path(old_name).suffix or ".jpg"
        image.original.save(
            f"original{extension}", ContentFile(buffer.read()), save=True
        )
        image.original.storage.delete(old_name)

        serializer = self.get_serializer(image)
        return Response(serializer.data)


# ---------------------------------------------------------------------------
# Federated search
# ---------------------------------------------------------------------------


class FederatedItemListSerializer(serializers.Serializer):
    """Minimal read-only serializer for a unified local+remote item result."""

    id = serializers.CharField()
    name = serializers.CharField()
    description = serializers.CharField()
    category = serializers.CharField()
    sales_type = serializers.CharField()
    condition = serializers.CharField()
    status = serializers.CharField()
    price = serializers.CharField(allow_null=True)
    price_currency = serializers.CharField()
    source = serializers.CharField(help_text="'local' or 'remote'")
    instance = serializers.CharField(
        allow_null=True, help_text="Remote instance domain for remote items"
    )
    ap_id = serializers.CharField(allow_null=True)
    first_image_url = serializers.CharField(allow_null=True)
    rental_period = serializers.CharField(allow_null=True, required=False)


def _federated_sort_key(search_query):
    """Return the sort key for merged local + remote results.

    The two sources are merged in memory, so they are ranked in Python (with
    the same weights as the SQL annotation) rather than in the database. With
    no search term there is nothing to rank and the name alone keeps the order
    stable and deterministic.
    """
    if not search_query:
        return lambda row: (0, row["name"].lower())
    return lambda row: (
        -relevance_score(search_query, row["name"], row["description"]),
        row["name"].lower(),
    )


class FederatedItemViewSet(viewsets.ViewSet):
    """Read-only ViewSet that returns a unified local + remote item search.

    Query parameters
    ----------------
    search : str
        Case-insensitive match on name / description. Every term has to occur,
        accents are folded, misspelled terms still match similar titles, and
        results come back ranked with title matches first — the same rules the
        local item list uses, applied to local and remote items alike.
    scope : ``local`` | ``federated`` | ``all`` (default ``all``)
        Restrict results to local items, remote items, or both.
    category : str
        Exact match on category.
    sales_type : str
        Exact match on sales_type.
    limit : int  (default 50, max 200)
        Page size.
    offset : int (default 0)
        Page offset.
    """

    permission_classes = [IsAuthenticatedOrReadOnly]

    def list(self, request):
        search_query = parse_search_query(request.query_params.get("search"))
        scope = request.query_params.get("scope", "all")
        category = request.query_params.get("category", "").strip()
        sales_type = request.query_params.get("sales_type", "").strip()
        try:
            limit = min(int(request.query_params.get("limit", 50)), 200)
            offset = max(int(request.query_params.get("offset", 0)), 0)
        except (TypeError, ValueError):
            limit, offset = 50, 0

        results = []

        # --- local items ---
        if scope in ("local", "all"):
            local_qs = (
                Item.objects.published()
                .filter(visibility=VisibilityType.PUBLIC)
                .select_related("user")
                .prefetch_related("images")
            )
            if search_query:
                local_qs = local_qs.filter(search_filter_q(search_query))
            if category:
                local_qs = local_qs.filter(category=category)
            if sales_type:
                local_qs = local_qs.filter(sales_type=sales_type)

            for item in local_qs:
                first_img = item.images.first()
                first_img_url = (
                    absolute_media_url(first_img.preview, request=request)
                    if first_img
                    else None
                )
                results.append(
                    {
                        "id": str(item.id),
                        "name": item.name or "",
                        "description": item.description or "",
                        "category": item.category or "",
                        "sales_type": item.sales_type or "",
                        "condition": item.condition or "",
                        "status": item.status or "",
                        "price": str(item.price.amount)
                        if item.price and item.price.amount
                        else None,
                        "price_currency": item.price_currency or "",
                        "source": "local",
                        "instance": None,
                        "ap_id": item.ap_id or None,
                        "first_image_url": first_img_url,
                        "rental_period": item.rental_period or None,
                    }
                )

        # --- remote items ---
        if scope in ("federated", "all"):
            remote_qs = (
                RemoteItem.objects.filter(deleted=False)
                .select_related("instance", "remote_actor")
                .prefetch_related("images")
            )
            if search_query:
                remote_qs = remote_qs.filter(search_filter_q(search_query))
            if category:
                remote_qs = remote_qs.filter(category=category)
            if sales_type:
                remote_qs = remote_qs.filter(sales_type=sales_type)

            for item in remote_qs:
                first_img = item.images.first()
                results.append(
                    {
                        "id": str(item.id),
                        "name": item.name or "",
                        "description": item.description or "",
                        "category": item.category or "",
                        "sales_type": item.sales_type or "",
                        "condition": item.condition or "",
                        "status": item.status or "",
                        "price": str(item.price) if item.price is not None else None,
                        "price_currency": item.price_currency or "",
                        "source": "remote",
                        "instance": item.instance_id,
                        "ap_id": item.ap_id or None,
                        "first_image_url": first_img.url if first_img else None,
                        "rental_period": None,
                    }
                )

        results.sort(key=_federated_sort_key(search_query))
        total = len(results)
        page = results[offset : offset + limit]

        serializer = FederatedItemListSerializer(page, many=True)
        return Response(
            {
                "count": total,
                "limit": limit,
                "offset": offset,
                "results": serializer.data,
            }
        )
