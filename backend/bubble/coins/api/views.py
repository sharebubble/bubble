"""API views for community-coin valuations."""

import uuid as uuid_module
from decimal import Decimal

from django.db.models import Avg, Count, Sum
from django.shortcuts import get_object_or_404
from django.utils.translation import gettext_lazy as _
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated, IsAuthenticatedOrReadOnly
from rest_framework.response import Response

from bubble.coins.api.serializers import (
    CoinTrackRecordSummarySerializer,
    CoinValuationSerializer,
    CoinValuationSuggestionSerializer,
)
from bubble.coins.models import CoinValuation
from bubble.core.api.pagination import SelectablePageSizePagination
from bubble.items.models import Item

ITEM_PARAM = OpenApiParameter(
    name="item",
    description="UUID of the item whose track record is requested.",
    required=True,
    type=str,
)


class CoinValuationViewSet(
    mixins.CreateModelMixin,
    viewsets.ReadOnlyModelViewSet,
):
    """Coin valuations recorded on free (zero-price) transactions.

    Reading is scoped to items the requesting user may see, so an item's
    track record is as public as the item itself. Writing is limited to the
    booker of the transaction being valued; posting again for the same
    booking replaces the earlier value rather than adding a second entry.
    """

    lookup_field = "id"
    serializer_class = CoinValuationSerializer
    permission_classes = [IsAuthenticatedOrReadOnly]
    pagination_class = SelectablePageSizePagination

    def get_queryset(self):
        """Return valuations on items visible to the requesting user.

        Archived items are included: a free item being sold on is exactly
        when its track record stops growing, and losing it at that point
        would throw away the history this feature exists to keep.
        """
        return CoinValuation.objects.filter(
            item__in=self._visible_items()
        ).select_related("user", "item", "booking")

    def _visible_items(self):
        return Item.objects.visible_to(self.request.user, include_archived=True)

    def _requested_item(self) -> Item:
        """Return the visible item named by the ``item`` query parameter."""
        item_id = self.request.query_params.get("item")
        if not item_id:
            raise ValidationError({"item": _("An 'item' query parameter is required.")})
        try:
            uuid_module.UUID(str(item_id))
        except (ValueError, TypeError, AttributeError) as exc:
            raise ValidationError({"item": _("Not a valid item id.")}) from exc

        return get_object_or_404(self._visible_items(), pk=item_id)

    @extend_schema(parameters=[ITEM_PARAM])
    def list(self, request, *args, **kwargs):
        """Return the coin track record of a single item, newest first."""
        item = self._requested_item()
        queryset = self.get_queryset().filter(item=item)

        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @extend_schema(parameters=[ITEM_PARAM], responses=CoinTrackRecordSummarySerializer)
    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Return how many coins an item has collected in total and on average."""
        item = self._requested_item()
        aggregates = (
            self.get_queryset()
            .filter(item=item)
            .aggregate(count=Count("id"), total=Sum("amount"), average=Avg("amount"))
        )

        serializer = CoinTrackRecordSummarySerializer(
            {
                "item": item.pk,
                "count": aggregates["count"],
                "total": aggregates["total"] or Decimal("0"),
                "average": aggregates["average"],
            }
        )
        return Response(serializer.data)

    @extend_schema(parameters=[ITEM_PARAM], responses=CoinValuationSuggestionSerializer)
    @action(detail=False, methods=["get"], permission_classes=[IsAuthenticated])
    def suggestion(self, request):
        """Return the value this user last picked for this item, if any.

        Lets the slider open on the price someone settled on previously
        instead of starting from scratch on every repeat transaction.
        """
        item = self._requested_item()
        previous = CoinValuation.objects.last_for(user=request.user, item=item)

        serializer = CoinValuationSuggestionSerializer(
            {
                "item": item.pk,
                "amount": previous.amount if previous else None,
                "rate": previous.rate if previous else None,
                "rental_period": (
                    previous.rental_period if previous else item.rental_period or ""
                ),
                "has_previous": previous is not None,
            }
        )
        return Response(serializer.data)
