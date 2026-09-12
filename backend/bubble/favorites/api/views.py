"""API views for item favorites."""

from django.db.models import Prefetch
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from bubble.favorites.models import FavoriteItem
from bubble.items.api.views import annotate_comment_stats
from bubble.items.models import Item

from .serializers import FavoriteItemIdsSerializer, FavoriteItemSerializer


class FavoriteItemViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """The current user's favorite items, newest mark first.

    Favorites are addressed by the *item* they point at rather than by their own
    id, so a client that knows the item it is showing can toggle the mark
    without first looking the favorite up.
    """

    serializer_class = FavoriteItemSerializer
    permission_classes = [IsAuthenticated]
    # Addressed by item id — see the class docstring.
    lookup_field = "item_id"
    lookup_url_kwarg = "item_id"
    filter_backends = []

    def get_queryset(self):
        # The items are pulled in through ``Prefetch`` rather than
        # ``select_related`` so they can carry the comment/rating annotations the
        # item serializer expects — without them every card would fall back to
        # its own aggregate query.
        return FavoriteItem.objects.for_user(self.request.user).prefetch_related(
            Prefetch(
                "item",
                queryset=annotate_comment_stats(
                    Item.objects.select_related("user", "location").prefetch_related(
                        "images"
                    )
                ),
            )
        )

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def create(self, request, *args, **kwargs):
        """Mark an item as favorite, tolerating a repeat of the same mark.

        Marking is driven by a toggle, so the same request can arrive twice (a
        double tap, a retried request). The second one returns the existing
        favorite instead of failing on the uniqueness constraint.
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = serializer.validated_data["item"]

        existing = FavoriteItem.objects.filter(user=request.user, item=item).first()
        if existing is not None:
            return Response(
                self.get_serializer(existing).data,
                status=status.HTTP_200_OK,
            )

        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(
            serializer.data,
            status=status.HTTP_201_CREATED,
            headers=headers,
        )

    @extend_schema(responses=FavoriteItemIdsSerializer)
    @action(detail=False, methods=["get"], url_path="item-ids")
    def item_ids(self, request):
        """Return just the favorited item ids.

        The heart on an item page only needs to know whether that item is in the
        set; fetching the ids keeps that check to one small, cacheable request
        instead of paging through the full favorites list.
        """
        # Straight off the manager rather than ``get_queryset``: the item
        # prefetch there would be loaded and thrown away for a list of ids.
        ids = FavoriteItem.objects.for_user(request.user).values_list(
            "item_id", flat=True
        )
        serializer = FavoriteItemIdsSerializer({"item_ids": list(ids)})
        return Response(serializer.data)
