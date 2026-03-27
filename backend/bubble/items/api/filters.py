"""FilterSet definitions for Item API endpoints."""

from __future__ import annotations

import logging

import django_filters
from django.db.models import Q, QuerySet

from bubble.items.models import (
    ConditionType,
    Item,
    ItemStatus,
    SalesType,
)

logger = logging.getLogger(__name__)


class ItemFilter(django_filters.FilterSet):
    """Filter items by common query parameters.

    Supported query params:
    - status: multiple choice filter for status integers
    - conditions: comma-delimited list of condition integers (0, 1, 2)
    - category: exact category value
    - published: boolean; if true restrict to published statuses
    - sales_type: multiple choice filter for sales type values
    - min_price / max_price: numeric range for price
    - user: user id for owner filtering
    - search: substring match on name or description (case-insensitive)
    - created_after / created_before: ISO8601 datetime filtering
    """

    status = django_filters.MultipleChoiceFilter(
        choices=ItemStatus.choices,
        field_name="status",
        conjoined=False,  # OR logic for multiple values
    )

    conditions = django_filters.MultipleChoiceFilter(
        choices=ConditionType.choices,
        field_name="condition",
        conjoined=False,  # OR logic for multiple values
    )

    published = django_filters.BooleanFilter(method="filter_published")

    sales_type = django_filters.MultipleChoiceFilter(
        choices=SalesType.choices,
        field_name="sales_type",
        conjoined=False,  # OR logic for multiple values
    )

    # Unified price range filters
    min_price = django_filters.NumberFilter(field_name="price", lookup_expr="gte")
    max_price = django_filters.NumberFilter(field_name="price", lookup_expr="lte")

    # Use built-in search filter
    search = django_filters.CharFilter(method="filter_search")

    # Use built-in datetime filters
    created_after = django_filters.IsoDateTimeFilter(
        field_name="created_at", lookup_expr="gte"
    )
    created_before = django_filters.IsoDateTimeFilter(
        field_name="created_at", lookup_expr="lte"
    )

    class Meta:
        model = Item
        fields = {
            "category": ["exact"],
            "user": ["exact"],  # Allow filtering by user ID
        }

    def filter_published(
        self,
        queryset: QuerySet[Item],
        name: str,
        value: bool,  # noqa: FBT001
    ):
        """Filter for published status based on StatusType.published()."""
        if value is None:
            return queryset
        if value:
            return queryset.filter(status__in=ItemStatus.published())
        # if explicitly false, exclude published statuses
        return queryset.exclude(status__in=ItemStatus.published())

    def filter_search(self, queryset: QuerySet[Item], name: str, value: str):
        """Search in name and description fields."""
        if not value:
            return queryset
        return queryset.filter(
            Q(name__icontains=value) | Q(description__icontains=value)
        )
