from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _


class NotificationPreference(models.Model):
    class ProviderType(models.TextChoices):
        ROCKETCHAT = "rocketchat", _("RocketChat")
        EMAIL = "email", _("Email")

    class EventType(models.TextChoices):
        NEW_MESSAGE = "new_message", _("New Message")

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
        choices=EventType.choices,
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
