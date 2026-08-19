"""Thin wrapper around the Apprise library used to deliver notifications.

Apprise gives Bubble a single, unified delivery path for every supported
channel (RocketChat, Signal, email, …). Each channel is expressed as an
Apprise URL built from an admin-configured template plus the recipient's
address (see :mod:`bubble.notifications.channels`).
"""

from __future__ import annotations

import logging

import apprise

logger = logging.getLogger(__name__)


def send_apprise_notification(url: str, title: str, body: str) -> bool:
    """Send a single notification via Apprise.

    Returns True when Apprise reports the notification was delivered.
    """
    client = apprise.Apprise()
    if not client.add(url):
        logger.error("Apprise rejected notification URL (invalid configuration).")
        return False

    success = client.notify(title=title, body=body)
    if not success:
        logger.error("Apprise failed to deliver notification.")
    return bool(success)
