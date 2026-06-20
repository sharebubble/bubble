from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from bubble.notifications.channels import (
    is_backend_configured,
    resolve_target,
)
from bubble.notifications.models import EventType, NotificationPreference
from bubble.notifications.tasks import deliver_notification

if TYPE_CHECKING:
    from bubble.users.models import User

logger = logging.getLogger(__name__)


def _user_language(user: User) -> str | None:
    profile = getattr(user, "profile", None)
    return getattr(profile, "language", "") or None


def _deliver_for_user(
    user: User,
    event_type: str,
    context: dict,
    prefs: list[NotificationPreference],
) -> None:
    """Enqueue Apprise delivery for each enabled, available channel of *user*."""
    language = _user_language(user)
    for pref in prefs:
        provider = pref.provider_type
        if not is_backend_configured(provider):
            continue
        target = resolve_target(provider, user)
        if not target:
            logger.debug(
                "Skipping %s notification for %s via %s: no recipient address.",
                event_type,
                user,
                provider,
            )
            continue
        logger.debug(
            "Dispatching %s notification to %s via %s", event_type, user, provider
        )
        deliver_notification(
            provider,
            event_type,
            context,
            target=target,
            language=language,
        )


def dispatch_notification(user: User, event_type: str, context: dict) -> None:
    """Enqueue notification delivery for a user's enabled preferences."""
    prefs = list(
        NotificationPreference.objects.filter(
            user=user,
            event_type=event_type,
            enabled=True,
        )
    )
    _deliver_for_user(user, event_type, context, prefs)


def dispatch_item_created(context: dict) -> None:
    """Notify every user who opted in to *new item* notifications.

    Unlike message/booking events (which target a specific user), a newly
    created item is announced to all subscribers through their own channels.
    """
    prefs = (
        NotificationPreference.objects.filter(
            event_type=EventType.NEW_ITEM,
            enabled=True,
        )
        .select_related("user", "user__profile")
        .order_by("user_id")
    )

    by_user: dict[object, list[NotificationPreference]] = {}
    users: dict[object, User] = {}
    for pref in prefs:
        by_user.setdefault(pref.user_id, []).append(pref)
        users[pref.user_id] = pref.user

    for user_id, user_prefs in by_user.items():
        _deliver_for_user(users[user_id], EventType.NEW_ITEM, context, user_prefs)
