"""API URLs for calendar link management (mounted under /api/)."""

from django.urls import path

from .views import (
    CollectionCalendarLinkView,
    ItemCalendarLinkView,
    MyCalendarView,
)

urlpatterns = [
    path(
        "items/<uuid:item_id>/calendar-link/",
        ItemCalendarLinkView.as_view(),
        name="item-calendar-link",
    ),
    path(
        "collections/<uuid:collection_id>/calendar-link/",
        CollectionCalendarLinkView.as_view(),
        name="collection-calendar-link",
    ),
    path("my-calendar/", MyCalendarView.as_view(), name="my-calendar"),
]
