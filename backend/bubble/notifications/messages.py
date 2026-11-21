"""Render notification titles and bodies for each event type.

Kept separate from delivery so the same formatting is reused across every
Apprise channel (RocketChat, Signal, email …). All strings go through gettext
so they are rendered in the recipient's preferred language.
"""

from __future__ import annotations

from django.conf import settings
from django.utils.translation import gettext as _

from bubble.notifications.models import EventType

# Not a member of EventType: nothing ever stores a preference for it. A user
# asking to test their devices is the consent, so it bypasses preferences
# entirely and only needs a title and body to render.
TEST_EVENT_TYPE = "test"


def _item_link(context: dict) -> str:
    item_id = context.get("item_id", "")
    frontend_url = (settings.FRONTEND_URL or "").rstrip("/")
    if frontend_url and item_id:
        return f"{frontend_url}/item/{item_id}"
    return ""


def notification_path(event_type: str, context: dict) -> str:
    """Return the in-app path a notification should open, relative to the site.

    Used as the click target for browser push. Relative rather than absolute so
    the service worker can focus an already-open tab on the same origin instead
    of opening a second window at a configured FRONTEND_URL.
    """
    if event_type in (EventType.NEW_MESSAGE, EventType.NEW_BOOKING):
        booking_id = context.get("booking_id", "")
        return f"/bookings/{booking_id}" if booking_id else "/bookings"

    if event_type == EventType.NEW_ITEM:
        item_id = context.get("item_id", "")
        return f"/item/{item_id}" if item_id else "/"

    if event_type == EventType.LEDGER:
        return context.get("path", "") or "/ledger"

    return "/"


def format_notification(event_type: str, context: dict) -> tuple[str, str]:
    """Return ``(title, body)`` for *event_type* given *context*."""

    if event_type == TEST_EVENT_TYPE:
        return _("Bubble"), _("Push notifications are working on this device.")

    if event_type == EventType.NEW_MESSAGE:
        title = _("New message")
        body = _("New message from %(sender)s about %(item_title)s:\n%(message)s") % {
            "sender": context.get("sender", ""),
            "item_title": context.get("item_title", ""),
            "message": context.get("message", ""),
        }
        return title, body

    if event_type == EventType.NEW_BOOKING:
        title = _("New booking")
        body = _("A new booking has been created for %(item_title)s.") % {
            "item_title": context.get("item_title", ""),
        }
        return title, body

    if event_type == EventType.NEW_ITEM:
        title = _("New item")
        name = context.get("name", "")
        description = context.get("description", "")
        link = _item_link(context)
        parts = [_("A new item is available: %(name)s") % {"name": name}]
        if description:
            parts.append(description)
        if link:
            parts.append(link)
        return title, "\n".join(parts)

    if event_type == EventType.LEDGER:
        return _("Community ledger"), _ledger_body(context)

    return _("Notification"), _("Notification: %(event_type)s") % {
        "event_type": event_type
    }


def _ledger_body(context: dict) -> str:
    """One sentence per ledger notice kind (see ``bubble.ledger.notify``)."""
    kind = context.get("kind", "")
    texts = {
        "posted": _(
            '%(actor)s booked "%(description)s": your balance changes by %(amount)s.'
        ),
        "disputed": _('%(actor)s disputes "%(description)s": %(reason)s'),
        "dispute_resolved": _(
            'Your dispute of "%(description)s" was closed: %(resolution)s'
        ),
        "comment": _('%(actor)s commented on "%(description)s": %(comment)s'),
        "cost_share_added": _(
            '%(actor)s split "%(description)s": your share is %(amount)s. '
            "Accept or object by %(deadline)s; after that it counts as accepted."
        ),
        "cost_share_changed": _(
            '%(actor)s changed "%(description)s": your share is now %(amount)s. '
            "Accept or object by %(deadline)s."
        ),
        "cost_share_reminder": _(
            'Reminder: "%(description)s" counts as accepted on %(deadline)s '
            "(your share: %(amount)s) unless you object."
        ),
        "cost_share_objected": _('%(actor)s objected to "%(description)s": %(reason)s'),
        "cost_share_cancelled": _('%(actor)s cancelled "%(description)s".'),
        "soft_limit": _(
            "Your balance is %(amount)s, below %(limit)s. Please top up soon."
        ),
        "sale_reminder": _(
            "Please confirm that you received %(item)s, or report a problem. "
            "Otherwise the purchase is confirmed automatically on %(deadline)s "
            "and %(amount)s is charged."
        ),
        "sale_auto_approved": _(
            "The purchase of %(item)s was confirmed automatically; %(amount)s was "
            "charged."
        ),
    }
    template = texts.get(kind)
    if template is None:
        return _("There is news in the community ledger.")
    values = {
        key: context.get(key, "")
        for key in (
            "actor",
            "description",
            "amount",
            "reason",
            "resolution",
            "comment",
            "deadline",
            "limit",
            "item",
        )
    }
    return template % values
