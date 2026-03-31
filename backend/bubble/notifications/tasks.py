from __future__ import annotations

import logging

from huey.contrib.djhuey import task

from bubble.notifications.providers.rocketchat import RocketChatProvider

logger = logging.getLogger(__name__)

_PROVIDERS = {
    "rocketchat": RocketChatProvider,
}


@task()
def deliver_notification(
    provider_type: str,
    user_id: str,
    event_type: str,
    context: dict,
) -> None:
    """Deliver a per-user notification via the specified provider."""

    provider_cls = _PROVIDERS.get(provider_type)
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


@task()
def deliver_channel_notification(
    provider_type: str,
    event_type: str,
    context: dict,
) -> None:
    """Deliver a channel-broadcast notification via the specified provider."""

    provider_cls = _PROVIDERS.get(provider_type)
    if provider_cls is None:
        logger.warning("Unknown notification provider type: %s", provider_type)
        return

    provider = provider_cls()
    try:
        success = provider.send_channel(event_type, context)
        if not success:
            logger.warning(
                "Provider %s channel send returned False for event %s",
                provider_type,
                event_type,
            )
    except Exception:
        logger.exception(
            "Error delivering channel %s notification via %s",
            event_type,
            provider_type,
        )
