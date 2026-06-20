"""DRF endpoints to view, (re)generate and revoke calendar sharing links.

The read-only feed URL for an item/collection is available to any logged-in
user who can view that resource, so they can subscribe in their calendar app.
Rotating (regenerating) or revoking a link stays restricted to the owner/
co-owners. Secrets are never embedded in public item/collection listings, so a
link is only obtainable by someone already authorised to see the resource.
"""

from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils.translation import gettext_lazy as _
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from bubble.caldav.api.serializers import (
    FeedLinkSerializer,
    PersonalCalendarSerializer,
)
from bubble.caldav.feeds import bookable_items_for_user, is_bookable
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


def _feed_payload(request, link, url_name, *, kind, can_manage: bool) -> dict:
    feed_url = request.build_absolute_uri(
        reverse(url_name, kwargs={"secret": link.secret})
    )
    return {
        "kind": kind,
        "feed_url": feed_url,
        "webcal_url": _webcal(feed_url),
        "can_manage": can_manage,
        "created_at": link.created_at,
        "updated_at": link.updated_at,
    }


@extend_schema(tags=["calendar"])
class ItemCalendarLinkView(APIView):
    """The read-only calendar feed for one bookable item.

    GET    — any logged-in user who can view the item gets the subscribe URL.
    POST   — owner/co-owner only: rotate the secret (revokes the previous URL).
    DELETE — owner/co-owner only: revoke the link entirely.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = FeedLinkSerializer

    def _get_manageable_item(self, request, item_id):
        """Return the item if the user may manage (rotate/revoke) it."""
        item = get_object_or_404(Item, pk=item_id)
        if not request.user.has_perm("items.change_item", item):
            self.permission_denied(request, message="Not allowed to manage this item.")
        return item

    @extend_schema(responses=FeedLinkSerializer)
    def get(self, request, item_id):
        item = get_object_or_404(Item, pk=item_id)
        if not is_bookable(item):
            return Response(
                {"detail": "Only bookable items (rent/borrow) have calendars."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        can_manage = request.user.has_perm("items.change_item", item)
        # Any logged-in user who can view the item may subscribe to its feed.
        can_view = (
            can_manage
            or bookable_items_for_user(request.user).filter(pk=item.pk).exists()
        )
        if not can_view:
            raise PermissionDenied(_("You cannot view this item."))
        link = CalendarLink.get_or_create_for_item(item)
        return Response(
            _feed_payload(
                request, link, "caldav:item-feed", kind="item", can_manage=can_manage
            )
        )

    @extend_schema(request=None, responses=FeedLinkSerializer)
    def post(self, request, item_id):
        item = self._get_manageable_item(request, item_id)
        if not is_bookable(item):
            return Response(
                {"detail": "Only bookable items (rent/borrow) have calendars."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        link = CalendarLink.get_or_create_for_item(item)
        link.rotate()
        return Response(
            _feed_payload(
                request, link, "caldav:item-feed", kind="item", can_manage=True
            )
        )

    @extend_schema(responses=OpenApiResponse(description="Link revoked"))
    def delete(self, request, item_id):
        item = self._get_manageable_item(request, item_id)
        CalendarLink.objects.filter(kind="item", item=item).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema(tags=["calendar"])
class CollectionCalendarLinkView(APIView):
    """The read-only calendar feed for a collection.

    GET    — any user who can view the collection gets the subscribe URL.
    POST   — owner/co-owner only: rotate the secret.
    DELETE — owner/co-owner only: revoke the link.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = FeedLinkSerializer

    def _get_manageable_collection(self, request, collection_id):
        collection = get_object_or_404(Collection, pk=collection_id)
        if not request.user.has_perm("collections.change_collection", collection):
            self.permission_denied(
                request, message="Not allowed to manage this collection."
            )
        return collection

    @extend_schema(responses=FeedLinkSerializer)
    def get(self, request, collection_id):
        collection = get_object_or_404(Collection, pk=collection_id)
        if not request.user.has_perm("collections.view_collection", collection):
            raise PermissionDenied(_("You cannot view this collection."))
        can_manage = request.user.has_perm("collections.change_collection", collection)
        link = CalendarLink.get_or_create_for_collection(collection)
        return Response(
            _feed_payload(
                request,
                link,
                "caldav:collection-feed",
                kind="collection",
                can_manage=can_manage,
            )
        )

    @extend_schema(request=None, responses=FeedLinkSerializer)
    def post(self, request, collection_id):
        collection = self._get_manageable_collection(request, collection_id)
        link = CalendarLink.get_or_create_for_collection(collection)
        link.rotate()
        return Response(
            _feed_payload(
                request,
                link,
                "caldav:collection-feed",
                kind="collection",
                can_manage=True,
            )
        )

    @extend_schema(responses=OpenApiResponse(description="Link revoked"))
    def delete(self, request, collection_id):
        collection = self._get_manageable_collection(request, collection_id)
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
