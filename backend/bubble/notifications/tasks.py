from __future__ import annotations

import logging

from huey.contrib.djhuey import task

from bubble.notifications.providers.rocketchat import RocketChatProvider

logger = logging.getLogger(__name__)


@task()
def deliver_notification(
    provider_type: str,
    user_id: str,
    event_type: str,
    context: dict,
) -> None:
    """Deliver a single notification via the specified provider."""

    providers = {
        "rocketchat": RocketChatProvider,
    }

    provider_cls = providers.get(provider_type)
    if provider_cls is None:
        logger.warning("Unknown notification provider type: %s", provider_type)
        return

    provider = provider_cls()
    try:
        success = provider.send(user_id, event_type, context)
        if not success:
            logger.warning(
                "Provider %s returned False for user %s / event %s",
                provider_type,
                user_id,
                event_type,
            )
    except Exception:
        logger.exception(
            "Error delivering %s notification to user %s for event %s",
            provider_type,
            user_id,
            event_type,
        )
