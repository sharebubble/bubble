from __future__ import annotations

import logging

from django.conf import settings
from django.utils import timezone, translation
from huey.contrib.djhuey import task

from bubble.notifications.channels import build_apprise_url, get_url_template
from bubble.notifications.messages import format_notification, notification_path
from bubble.notifications.providers.apprise_provider import send_apprise_notification
from bubble.notifications.providers.webpush_provider import send_web_push

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
            logger.error(
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


@task()
def deliver_web_push(
    user_id: int,
    event_type: str,
    context: dict,
    *,
    language: str | None = None,
) -> None:
    """Fan a notification out to every browser *user_id* has subscribed.

    Takes a user id rather than the subscriptions themselves so the task always
    works from the current set: a device can unsubscribe between the event and
    the task running, and a queued snapshot would push to endpoints that no
    longer exist.

    Subscriptions the push service reports as gone are deleted here — that is the
    only way they ever get cleaned up, since browsers do not tell the server when
    they drop one.
    """
    # Imported lazily: this module is imported at app-load time by huey's
    # autodiscovery, before the app registry is populated.
    from bubble.notifications.models import PushSubscription  # noqa: PLC0415

    subscriptions = list(PushSubscription.objects.filter(user_id=user_id))
    if not subscriptions:
        logger.debug("No push subscriptions for user %s — skipping.", user_id)
        return

    with translation.override(language or settings.LANGUAGE_CODE):
        title, body = format_notification(event_type, context)

    subject_id = context.get("booking_id") or context.get("item_id") or ""
    payload = {
        "title": title,
        "body": body,
        "url": notification_path(event_type, context),
        # Groups repeat notifications about the same thing so a phone shows one
        # entry per conversation rather than a stack of twenty.
        "tag": f"{event_type}:{subject_id}",
        "event_type": event_type,
    }

    expired_ids = []
    delivered_ids = []
    for subscription in subscriptions:
        result = send_web_push(subscription.subscription_info, payload)
        if result.expired:
            expired_ids.append(subscription.pk)
        elif result.delivered:
            delivered_ids.append(subscription.pk)

    if expired_ids:
        PushSubscription.objects.filter(pk__in=expired_ids).delete()
        logger.info(
            "Removed %s expired push subscription(s) for user %s.",
            len(expired_ids),
            user_id,
        )

    # Only the devices that actually accepted this notification. Marking the
    # whole batch would make a permanently flaky endpoint look healthy for as
    # long as any other device of the same user still works.
    if delivered_ids:
        PushSubscription.objects.filter(pk__in=delivered_ids).update(
            last_used_at=timezone.now()
        )

    logger.debug(
        "Web push for user %s (%s): %s delivered, %s expired, %s failed.",
        user_id,
        event_type,
        len(delivered_ids),
        len(expired_ids),
        len(subscriptions) - len(delivered_ids) - len(expired_ids),
    )
