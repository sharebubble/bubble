"""FilterSet definitions for Item API endpoints."""

from __future__ import annotations

import logging

import django_filters
from django.db.models import Q, QuerySet
from django.utils.translation import gettext_lazy as _

from bubble.items.api.search import ranked_search
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
    - free: boolean; if true restrict to free (null or zero price) items
    - user: user id for owner filtering
    - collection: collection id; restrict to items in the given collection
    - search: relevance-ranked match on name and description. Every term has
      to occur (quoted "phrases" count as one term); title matches rank above
      description-only ones. Use ``ordering=relevance`` to sort by that rank —
      it is the default ordering while a search is active.
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

    # Restrict to free items. Donate/borrow items carry a NULL price (enforced by
    # a DB constraint), so "free" means a null or zero price.
    free = django_filters.BooleanFilter(method="filter_free")

    # Restrict to items contained in a given collection
    collection = django_filters.UUIDFilter(field_name="collections__id")

    # Free-text search. Ranked so that title matches come first — see
    # ``bubble.items.api.search`` for the matching and weighting rules.
    search = django_filters.CharFilter(
        method="filter_search",
        label=_("Search"),
        help_text=_(
            "Free-text search over title and description. All terms must "
            'match; use "quotes" to search for a phrase. Results are ranked '
            "with title matches first."
        ),
    )

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

    def filter_free(
        self,
        queryset: QuerySet[Item],
        name: str,
        value: bool,  # noqa: FBT001
    ):
        """Filter free items (null or zero price)."""
        if value is None:
            return queryset
        free_q = Q(price__isnull=True) | Q(price=0)
        if value:
            return queryset.filter(free_q)
        # if explicitly false, restrict to priced items
        return queryset.exclude(free_q)

    def filter_search(self, queryset: QuerySet[Item], name: str, value: str):
        """Match name and description, annotating each row with its rank."""
        return ranked_search(queryset, value)
