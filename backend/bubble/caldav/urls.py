"""Non-API URLs: public iCalendar feeds and the private CalDAV server.

Mounted under ``/caldav/`` in the project URLConf.
"""

from django.urls import path

from . import views

app_name = "caldav"

urlpatterns = [
    # Public read-only iCalendar subscription feeds. The optional <label>
    # segment is a cosmetic slug (ignored server-side) so calendar clients that
    # derive a subscription's name from its URL show the item/collection name.
    path("item/<str:secret>.ics", views.item_feed, name="item-feed"),
    path(
        "item/<str:secret>/<str:label>.ics",
        views.item_feed,
        name="item-feed-labeled",
    ),
    path("collection/<str:secret>.ics", views.collection_feed, name="collection-feed"),
    path(
        "collection/<str:secret>/<str:label>.ics",
        views.collection_feed,
        name="collection-feed-labeled",
    ),
    # Private read-write CalDAV hierarchy.
    path("dav/<str:secret>/", views.CalDAVView.as_view(), name="dav-home"),
    path(
        "dav/<str:secret>/<uuid:item_id>/",
        views.CalDAVView.as_view(),
        name="dav-calendar",
    ),
    path(
        "dav/<str:secret>/<uuid:item_id>/<str:resource>",
        views.CalDAVView.as_view(),
        name="dav-event",
    ),
    # No-trailing-slash aliases for collection resources. Some CalDAV clients
    # probe collection URLs without a trailing slash, and Django's APPEND_SLASH
    # redirect does not apply to non-GET methods such as PROPFIND/OPTIONS.
    path("dav/<str:secret>", views.CalDAVView.as_view(), name="dav-home-noslash"),
    path(
        "dav/<str:secret>/<uuid:item_id>",
        views.CalDAVView.as_view(),
        name="dav-calendar-noslash",
    ),
]
