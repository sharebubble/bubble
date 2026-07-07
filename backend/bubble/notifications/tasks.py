from __future__ import annotations

import logging

from django.conf import settings
from django.utils import translation
from huey.contrib.djhuey import task

from bubble.notifications.channels import build_apprise_url, get_url_template
from bubble.notifications.messages import format_notification
from bubble.notifications.providers.apprise_provider import send_apprise_notification

logger = logging.getLogger(__name__)


@task()
def deliver_notification(
    provider_type: str,
    event_type: str,
    context: dict,
    *,
    target: str,
    language: str | None = None,
) -> None:
    """Deliver a notification to a single recipient via Apprise.

    *target* is the recipient's address on the channel (RocketChat username,
    Signal phone number or email address). The notification text is rendered in
    *language* when provided, otherwise the project default.
    """

    template = get_url_template(provider_type)
    if not template:
        logger.debug(
            "No Apprise URL configured for provider %s — skipping.", provider_type
        )
        return
    if not target:
        logger.debug(
            "No recipient target for provider %s — skipping %s notification.",
            provider_type,
            event_type,
        )
        return

    url = build_apprise_url(template, target)

    with translation.override(language or settings.LANGUAGE_CODE):
        title, body = format_notification(event_type, context)

    try:
        success = send_apprise_notification(url, title, body)
        if not success:
            logger.warning(
                "Apprise delivery failed (provider=%s event=%s)",
                provider_type,
                event_type,
            )
    except Exception:
        logger.exception(
            "Error delivering %s notification (provider=%s event=%s)",
            event_type,
            provider_type,
            event_type,
        )
