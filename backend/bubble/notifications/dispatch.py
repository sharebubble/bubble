from __future__ import annotations

import logging

from bubble.notifications.models import NotificationPreference
from bubble.notifications.tasks import deliver_notification

logger = logging.getLogger(__name__)


def dispatch_notification(user_id: int | str, event_type: str, context: dict) -> None:
    """Look up enabled preferences for the user and enqueue delivery tasks."""

    prefs = NotificationPreference.objects.filter(
        user_id=user_id,
        event_type=event_type,
        enabled=True,
    )

    for pref in prefs:
        logger.debug(
            "Dispatching %s notification to user %s via %s",
            event_type,
            user_id,
            pref.provider_type,
        )
        deliver_notification(pref.provider_type, str(user_id), event_type, context)
