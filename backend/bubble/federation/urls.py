"""URL patterns for the federation app."""

from django.urls import path

from bubble.federation import views

app_name = "federation"

# Well-known discovery endpoints
wellknown_patterns = [
    path("webfinger", views.webfinger, name="webfinger"),
    path("nodeinfo", views.nodeinfo_index, name="nodeinfo-index"),
    path("host-meta", views.host_meta, name="host-meta"),
]

# Main federation endpoints
federation_patterns = [
    path("instance-actor", views.instance_actor, name="instance-actor"),
    path("inbox", views.InboxView.as_view(), name="shared-inbox"),
    path("health", views.federation_health, name="health"),
    path("nodeinfo/2.1", views.nodeinfo_21, name="nodeinfo-21"),
    path("items/<uuid:pk>", views.item_ap_object, name="item-ap-object"),
    path("bookings/<uuid:pk>", views.booking_ap_object, name="booking-ap-object"),
    path("messages/<uuid:pk>", views.message_ap_object, name="message-ap-object"),
    path("users/<str:username>", views.person_actor, name="person-actor"),
    path("users/<str:username>/inbox", views.InboxView.as_view(), name="person-inbox"),
    path("users/<str:username>/outbox", views.person_outbox, name="person-outbox"),
    path(
        "users/<str:username>/followers",
        views.person_followers,
        name="person-followers",
    ),
    path(
        "users/<str:username>/following",
        views.person_following,
        name="person-following",
    ),
    path(
        "users/<str:username>/featured", views.person_featured, name="person-featured"
    ),
]
