"""Endpoints for managing this browser's push subscription.

Deliberately not a ModelViewSet: a subscription is not a resource the user
browses, it is a device-local fact the browser registers and revokes. The three
actions map onto exactly what the frontend does — subscribe this browser,
unsubscribe this browser, and prove the whole path works.
"""

from __future__ import annotations

from django.utils.translation import gettext as _
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from bubble.notifications.messages import TEST_EVENT_TYPE
from bubble.notifications.models import PushSubscription
from bubble.notifications.tasks import deliver_web_push
from bubble.notifications.webpush import is_configured

from .push_serializers import (
    PushSubscriptionCreateSerializer,
    PushSubscriptionDeleteSerializer,
    PushSubscriptionStatusSerializer,
)


class PushSubscriptionViewSet(GenericViewSet):
    """Register, drop and test the current browser's push subscription."""

    permission_classes = [IsAuthenticated]
    serializer_class = PushSubscriptionCreateSerializer

    def get_serializer_class(self):
        if self.action == "unsubscribe":
            return PushSubscriptionDeleteSerializer
        if self.action == "push_status":
            return PushSubscriptionStatusSerializer
        return PushSubscriptionCreateSerializer

    @extend_schema(
        request=PushSubscriptionCreateSerializer,
        responses={201: PushSubscriptionStatusSerializer},
    )
    @action(detail=False, methods=["post"])
    def subscribe(self, request):
        """Store the subscription the browser just created."""
        if not is_configured():
            return Response(
                {"detail": _("Push notifications are not configured on this server.")},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(request.user)

        return Response(
            self._status_payload(request.user), status=status.HTTP_201_CREATED
        )

    @extend_schema(
        request=PushSubscriptionDeleteSerializer,
        responses={200: PushSubscriptionStatusSerializer},
    )
    @action(detail=False, methods=["post"])
    def unsubscribe(self, request):
        """Forget one subscription.

        Scoped to the requesting user so an endpoint cannot be used to delete
        someone else's registration. Idempotent: unsubscribing a browser that was
        never registered (or was already pruned as expired) is a success.
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        PushSubscription.objects.filter(
            user=request.user, endpoint=serializer.validated_data["endpoint"]
        ).delete()

        return Response(self._status_payload(request.user), status=status.HTTP_200_OK)

    # Named for the URL, not the method: `status` alone would read as the DRF
    # status module that the responses below use.
    @extend_schema(responses={200: PushSubscriptionStatusSerializer})
    @action(detail=False, methods=["get"], url_path="status")
    def push_status(self, request):
        """Whether push is configured here and how many devices are registered."""
        return Response(self._status_payload(request.user), status=status.HTTP_200_OK)

    @extend_schema(request=None, responses={202: PushSubscriptionStatusSerializer})
    @action(detail=False, methods=["post"])
    def test(self, request):
        """Send a test notification to every device of the current user.

        The one step of the chain that cannot be checked from the browser alone:
        it proves the VAPID keys, the push service and the service worker's push
        handler all agree. Bypasses the user's event preferences on purpose — the
        request *is* the consent.
        """
        if not is_configured():
            return Response(
                {"detail": _("Push notifications are not configured on this server.")},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        if not PushSubscription.objects.filter(user=request.user).exists():
            return Response(
                {"detail": _("This account has no push subscriptions.")},
                status=status.HTTP_400_BAD_REQUEST,
            )

        deliver_web_push(
            request.user.pk,
            TEST_EVENT_TYPE,
            {},
            language=self._user_language(request.user),
        )
        return Response(
            self._status_payload(request.user), status=status.HTTP_202_ACCEPTED
        )

    @staticmethod
    def _user_language(user) -> str | None:
        profile = getattr(user, "profile", None)
        return getattr(profile, "language", "") or None

    @staticmethod
    def _status_payload(user) -> dict:
        return {
            "configured": is_configured(),
            "device_count": PushSubscription.objects.filter(user=user).count(),
        }
