"""DRF endpoints to view, (re)generate and revoke calendar sharing links.

Secrets are only ever exposed to the owner of the underlying resource through
these authenticated endpoints — never in public item/collection listings — so
the feed URLs remain unguessable.
"""

from django.shortcuts import get_object_or_404
from django.urls import reverse
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from bubble.caldav.api.serializers import (
    FeedLinkSerializer,
    PersonalCalendarSerializer,
)
from bubble.caldav.feeds import is_bookable
from bubble.caldav.models import CalendarLink
from bubble.collections.models import Collection
from bubble.items.models import Item


def _webcal(url: str) -> str:
    """A webcal:// variant lets calendar apps subscribe with one click."""
    if url.startswith("https://"):
        return "webcal://" + url[len("https://") :]
    if url.startswith("http://"):
        return "webcal://" + url[len("http://") :]
    return url


def _feed_payload(request, link, url_name, *, kind) -> dict:
    feed_url = request.build_absolute_uri(
        reverse(url_name, kwargs={"secret": link.secret})
    )
    return {
        "kind": kind,
        "feed_url": feed_url,
        "webcal_url": _webcal(feed_url),
        "created_at": link.created_at,
        "updated_at": link.updated_at,
    }


@extend_schema(tags=["calendar"])
class ItemCalendarLinkView(APIView):
    """Manage the public read-only calendar feed for one bookable item.

    GET    — return the feed URL (creating the link on first access).
    POST   — rotate the secret (revokes the previous URL).
    DELETE — revoke the link entirely.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = FeedLinkSerializer

    def _get_item(self, request, item_id):
        item = get_object_or_404(Item, pk=item_id)
        if not request.user.has_perm("items.change_item", item):
            self.permission_denied(request, message="Not allowed to manage this item.")
        if not is_bookable(item):
            return None
        return item

    @extend_schema(responses=FeedLinkSerializer)
    def get(self, request, item_id):
        item = self._get_item(request, item_id)
        if item is None:
            return Response(
                {"detail": "Only bookable items (rent/borrow) have calendars."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        link = CalendarLink.get_or_create_for_item(item)
        return Response(_feed_payload(request, link, "caldav:item-feed", kind="item"))

    @extend_schema(request=None, responses=FeedLinkSerializer)
    def post(self, request, item_id):
        item = self._get_item(request, item_id)
        if item is None:
            return Response(
                {"detail": "Only bookable items (rent/borrow) have calendars."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        link = CalendarLink.get_or_create_for_item(item)
        link.rotate()
        return Response(_feed_payload(request, link, "caldav:item-feed", kind="item"))

    @extend_schema(responses=OpenApiResponse(description="Link revoked"))
    def delete(self, request, item_id):
        item = self._get_item(request, item_id)
        if item is not None:
            CalendarLink.objects.filter(kind="item", item=item).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema(tags=["calendar"])
class CollectionCalendarLinkView(APIView):
    """Manage the public read-only calendar feed for a collection."""

    permission_classes = [IsAuthenticated]
    serializer_class = FeedLinkSerializer

    def _get_collection(self, request, collection_id):
        collection = get_object_or_404(Collection, pk=collection_id)
        if not request.user.has_perm("collections.change_collection", collection):
            self.permission_denied(
                request, message="Not allowed to manage this collection."
            )
        return collection

    @extend_schema(responses=FeedLinkSerializer)
    def get(self, request, collection_id):
        collection = self._get_collection(request, collection_id)
        link = CalendarLink.get_or_create_for_collection(collection)
        return Response(
            _feed_payload(request, link, "caldav:collection-feed", kind="collection")
        )

    @extend_schema(request=None, responses=FeedLinkSerializer)
    def post(self, request, collection_id):
        collection = self._get_collection(request, collection_id)
        link = CalendarLink.get_or_create_for_collection(collection)
        link.rotate()
        return Response(
            _feed_payload(request, link, "caldav:collection-feed", kind="collection")
        )

    @extend_schema(responses=OpenApiResponse(description="Link revoked"))
    def delete(self, request, collection_id):
        collection = self._get_collection(request, collection_id)
        CalendarLink.objects.filter(kind="collection", collection=collection).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema(tags=["calendar"])
class MyCalendarView(APIView):
    """Manage the caller's private read-write CalDAV endpoint.

    Creating events in this calendar turns them into booking requests for the
    chosen item, made by the authenticated user.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = PersonalCalendarSerializer

    def _payload(self, request, link) -> dict:
        dav_url = request.build_absolute_uri(
            reverse("caldav:dav-home", kwargs={"secret": link.secret})
        )
        return {
            "kind": "user",
            "caldav_url": dav_url,
            "created_at": link.created_at,
            "updated_at": link.updated_at,
        }

    @extend_schema(responses=PersonalCalendarSerializer)
    def get(self, request):
        link = CalendarLink.get_or_create_for_user(request.user)
        return Response(self._payload(request, link))

    @extend_schema(request=None, responses=PersonalCalendarSerializer)
    def post(self, request):
        link = CalendarLink.get_or_create_for_user(request.user)
        link.rotate()
        return Response(self._payload(request, link))

    @extend_schema(responses=OpenApiResponse(description="Endpoint revoked"))
    def delete(self, request):
        CalendarLink.objects.filter(kind="user", user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
