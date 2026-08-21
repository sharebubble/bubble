"""FilterSet definitions for Books API endpoints."""

import django_filters
from django.utils.translation import gettext_lazy as _

from bubble.items.api.search import ranked_search
from bubble.items.models import Item

# Book metadata lives in the JSONB `properties` blob. These are the parts worth
# searching alongside the title and description; a hit here ranks between a
# title hit and a description-only one.
BOOK_SEARCH_FIELDS = (
    "properties__isbn",
    "properties__topic",
    "properties__authors",
    "properties__publisher",
)


class BookFilter(django_filters.FilterSet):
    """Filter books by common query parameters using JSONB lookups."""

    # Free-text search across the title, description and the book metadata.
    # Ranked title-first — see ``bubble.items.api.search``.
    search = django_filters.CharFilter(
        method="filter_search",
        label=_("Search"),
        help_text=_(
            "Free-text search over title, description, author, publisher, "
            'topic and ISBN. All terms must match; use "quotes" to search '
            "for a phrase. Accents are ignored and misspelled terms still "
            "match similar titles. Results are ranked with title matches "
            "first and approximate matches last."
        ),
    )

    isbn = django_filters.CharFilter(
        field_name="properties__isbn", lookup_expr="iexact"
    )
    author_name = django_filters.CharFilter(method="filter_author_name")
    genre_name = django_filters.CharFilter(method="filter_genre_name")
    publisher_name = django_filters.CharFilter(
        field_name="properties__publisher", lookup_expr="icontains"
    )
    shelf_name = django_filters.CharFilter(
        field_name="properties__shelf", lookup_expr="icontains"
    )
    year = django_filters.NumberFilter(field_name="properties__year")
    year_min = django_filters.NumberFilter(
        field_name="properties__year", lookup_expr="gte"
    )
    year_max = django_filters.NumberFilter(
        field_name="properties__year", lookup_expr="lte"
    )
    topic = django_filters.CharFilter(
        field_name="properties__topic", lookup_expr="icontains"
    )
    language = django_filters.CharFilter(
        field_name="properties__language", lookup_expr="iexact"
    )

    class Meta:
        model = Item
        fields = [
            "search",
            "isbn",
            "author_name",
            "genre_name",
            "publisher_name",
            "shelf_name",
            "year",
            "year_min",
            "year_max",
            "topic",
            "language",
        ]

    def filter_search(self, queryset, name, value):
        """Match title, description and book metadata, ranked title-first."""
        return ranked_search(queryset, value, extra_fields=BOOK_SEARCH_FIELDS)

    def filter_author_name(self, queryset, name, value):
        """Filter books where any author name contains the value."""
        # Perform a case-insensitive substring match on the authors JSON value
        # using icontains; this does not use the JSONB array __contains operator.
        return queryset.filter(properties__authors__icontains=value)

    def filter_genre_name(self, queryset, name, value):
        """Filter books where any genre name contains the value."""
        return queryset.filter(properties__genres__icontains=value)
