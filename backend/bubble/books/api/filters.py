"""FilterSet definitions for Books API endpoints."""

import django_filters

from bubble.items.models import Item


class BookFilter(django_filters.FilterSet):
    """Filter books by common query parameters using JSONB lookups."""

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

    def filter_author_name(self, queryset, name, value):
        """Filter books where any author name contains the value."""
        # Perform a case-insensitive substring match on the authors JSON value
        # using icontains; this does not use the JSONB array __contains operator.
        return queryset.filter(properties__authors__icontains=value)

    def filter_genre_name(self, queryset, name, value):
        """Filter books where any genre name contains the value."""
        return queryset.filter(properties__genres__icontains=value)
