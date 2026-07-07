"""Render notification titles and bodies for each event type.

Kept separate from delivery so the same formatting is reused across every
Apprise channel (RocketChat, Signal, email …). All strings go through gettext
so they are rendered in the recipient's preferred language.
"""

from __future__ import annotations

from django.conf import settings
from django.utils.translation import gettext as _

from bubble.notifications.models import EventType


def _item_link(context: dict) -> str:
    item_id = context.get("item_id", "")
    frontend_url = (settings.FRONTEND_URL or "").rstrip("/")
    if frontend_url and item_id:
        return f"{frontend_url}/item/{item_id}"
    return ""


def format_notification(event_type: str, context: dict) -> tuple[str, str]:
    """Return ``(title, body)`` for *event_type* given *context*."""

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

    return _("Notification"), _("Notification: %(event_type)s") % {
        "event_type": event_type
    }
