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
