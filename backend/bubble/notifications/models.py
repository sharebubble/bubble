from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _


class EventType(models.TextChoices):
    """All supported notification event types."""

    NEW_MESSAGE = "new_message", _("New Message")
    NEW_BOOKING = "new_booking", _("New Booking")
    NEW_ITEM = "new_item", _("New Item")


# User-facing preference groups. A single toggle in the profile can control
# more than one underlying event type — "messages" covers both new chat
# messages and new bookings, since both relate to a user's own items/bookings.
EVENT_GROUPS: dict[str, tuple[str, ...]] = {
    "messages": (EventType.NEW_MESSAGE, EventType.NEW_BOOKING),
    "new_item": (EventType.NEW_ITEM,),
}


class NotificationPreference(models.Model):
    class ProviderType(models.TextChoices):
        ROCKETCHAT = "rocketchat", _("RocketChat")
        SIGNAL = "signal", _("Signal")
        MATRIX = "matrix", _("Matrix")
        EMAIL = "email", _("Email")
        WEBPUSH = "webpush", _("Browser push")

    id = models.UUIDField(default=uuid.uuid4, primary_key=True, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notification_preferences",
        verbose_name=_("user"),
    )
    provider_type = models.CharField(
        max_length=50,
        choices=ProviderType.choices,
        verbose_name=_("provider type"),
    )
    event_type = models.CharField(
        max_length=50,
        choices=EventType,
        verbose_name=_("event type"),
    )
    enabled = models.BooleanField(default=False, verbose_name=_("enabled"))
    created_at = models.DateTimeField(auto_now_add=True, verbose_name=_("created at"))

    class Meta:
        unique_together = [("user", "provider_type", "event_type")]
        verbose_name = _("Notification Preference")
        verbose_name_plural = _("Notification Preferences")

    def __str__(self):
        state = "on" if self.enabled else "off"
        return f"{self.user} — {self.provider_type}/{self.event_type} ({state})"


class PushSubscription(models.Model):
    """A single browser's Push API subscription.

    Unlike the Apprise channels, web push addresses a *device* rather than a
    user: every browser profile that opts in hands over its own endpoint plus the
    two keys used to encrypt the payload for it. One user therefore has as many
    subscriptions as devices, and whether they are notified at all is still
    governed by their :class:`NotificationPreference` rows for ``webpush``.

    Subscriptions expire on their own — a browser may rotate or drop one at any
    time — so a push service answering 404/410 is normal and means "delete this
    row", not "retry later".
    """

    id = models.UUIDField(default=uuid.uuid4, primary_key=True, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="push_subscriptions",
        verbose_name=_("user"),
    )
    # Opaque push-service URL. Long enough for the FCM/Mozilla/WNS endpoints seen
    # in the wild, and unique so re-subscribing the same browser updates the row
    # instead of accumulating duplicates.
    endpoint = models.URLField(max_length=500, unique=True, verbose_name=_("endpoint"))
    # Client public key (P-256, base64url) used to encrypt the payload.
    p256dh = models.CharField(max_length=255, verbose_name=_("client public key"))
    # Client auth secret (base64url) mixed into the encryption context.
    auth = models.CharField(max_length=255, verbose_name=_("client auth secret"))
    user_agent = models.CharField(
        max_length=300,
        blank=True,
        default="",
        verbose_name=_("user agent"),
        help_text=_(
            "Reported by the browser at subscribe time, to tell devices apart."
        ),
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name=_("created at"))
    last_used_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name=_("last used at"),
        help_text=_("Last time a notification was accepted by the push service."),
    )

    class Meta:
        verbose_name = _("Push Subscription")
        verbose_name_plural = _("Push Subscriptions")
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "-created_at"])]

    def __str__(self):
        return f"{self.user} — {self.endpoint[:60]}"

    @property
    def subscription_info(self) -> dict:
        """The subscription in the shape :func:`pywebpush.webpush` expects."""
        return {
            "endpoint": self.endpoint,
            "keys": {"p256dh": self.p256dh, "auth": self.auth},
        }
