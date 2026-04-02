from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from bubble.notifications.models import CHANNEL_EVENTS, NotificationPreference
from bubble.notifications.tasks import deliver_notification

if TYPE_CHECKING:
    from bubble.users.models import User

logger = logging.getLogger(__name__)


def dispatch_notification(
    user: User,
    event_type: str,
    context: dict,
) -> None:
    """Enqueue per-user notification delivery for enabled preferences."""

    prefs = NotificationPreference.objects.filter(
        user=user,
        event_type=event_type,
        enabled=True,
    )

    for pref in prefs:
        logger.debug(
            "Dispatching %s notification to user %s via %s",
            event_type,
            user,
            pref.provider_type,
        )
        deliver_notification(
            pref.provider_type, event_type, context, user_id=user.username
        )


def dispatch_channel_notification(event_type: str, context: dict) -> None:
    """Enqueue a channel-broadcast notification (no per-user preferences)."""

    if event_type not in CHANNEL_EVENTS:
        logger.warning(
            "dispatch_channel_notification called for non-channel event: %s",
            event_type,
        )
        return

    for provider_type in NotificationPreference.ProviderType:
        logger.debug(
            "Dispatching channel %s notification via %s",
            event_type,
            provider_type,
        )
        deliver_notification(str(provider_type), event_type, context)
