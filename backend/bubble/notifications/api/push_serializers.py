"""Serializers for the browser Push API subscription endpoints.

The request bodies mirror what ``PushSubscription.toJSON()`` produces in the
browser, so the frontend can post the subscription object almost verbatim.
"""

from __future__ import annotations

from rest_framework import serializers

from bubble.notifications.models import PushSubscription


class PushSubscriptionKeysSerializer(serializers.Serializer):
    """The two client keys the payload is encrypted with."""

    p256dh = serializers.CharField(max_length=255)
    auth = serializers.CharField(max_length=255)


class PushSubscriptionCreateSerializer(serializers.Serializer):
    """A browser subscription as handed over by ``pushManager.subscribe()``."""

    endpoint = serializers.URLField(max_length=500)
    keys = PushSubscriptionKeysSerializer()
    # Optional label so a user can tell their devices apart in the admin.
    user_agent = serializers.CharField(
        max_length=300, required=False, allow_blank=True, default=""
    )

    def save(self, user) -> PushSubscription:
        """Create or refresh the row for this endpoint.

        Keyed on the endpoint rather than (user, endpoint): the endpoint is
        globally unique and a shared browser profile may re-subscribe as a
        different user, which must move the row rather than collide with it.
        """
        keys = self.validated_data["keys"]
        subscription, _created = PushSubscription.objects.update_or_create(
            endpoint=self.validated_data["endpoint"],
            defaults={
                "user": user,
                "p256dh": keys["p256dh"],
                "auth": keys["auth"],
                "user_agent": self.validated_data.get("user_agent", ""),
            },
        )
        return subscription


class PushSubscriptionDeleteSerializer(serializers.Serializer):
    """Identifies the subscription to drop."""

    endpoint = serializers.URLField(max_length=500)


class PushSubscriptionStatusSerializer(serializers.Serializer):
    """Read-only view of the push channel for the current user."""

    configured = serializers.BooleanField(
        help_text="Whether this deployment has VAPID keys and can send push at all."
    )
    device_count = serializers.IntegerField(
        help_text="Number of browsers this user has subscribed."
    )
