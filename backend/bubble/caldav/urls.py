"""Non-API URLs: public iCalendar feeds and the private CalDAV server.

Mounted under ``/caldav/`` in the project URLConf.
"""

from django.urls import path

from . import views

app_name = "caldav"

urlpatterns = [
    # Public read-only iCalendar subscription feeds.
    path("item/<str:secret>.ics", views.item_feed, name="item-feed"),
    path("collection/<str:secret>.ics", views.collection_feed, name="collection-feed"),
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
]
