from __future__ import annotations

import logging

import httpx
from constance import config

from .base import BaseNotificationProvider

logger = logging.getLogger(__name__)


class RocketChatProvider(BaseNotificationProvider):
    provider_type = "rocketchat"

    def send(self, user_id: str, event_type: str, context: dict) -> bool:

        webhook_url: str = config.ROCKETCHAT_WEBHOOK_URL
        channel: str = config.ROCKETCHAT_CHANNEL

        if not webhook_url:
            logger.debug(
                "RocketChat webhook URL not configured, skipping notification."
            )
            return False

        text = self._format_message(event_type, context)
        payload: dict = {"text": text}
        if channel:
            payload["channel"] = channel

        try:
            response = httpx.post(webhook_url, json=payload, timeout=10)
            response.raise_for_status()
        except httpx.HTTPError:
            logger.exception(
                "Failed to send RocketChat notification for user %s / event %s",
                user_id,
                event_type,
            )
            return False
        else:
            logger.info(
                "RocketChat notification sent for user %s / event %s",
                user_id,
                event_type,
            )
            return True

    def _format_message(self, event_type: str, context: dict) -> str:
        if event_type == "new_message":
            booking_uuid = context.get("booking_uuid", "")
            message = context.get("message", "")
            return (
                f":speech_balloon: New message in booking `{booking_uuid}`:\n"
                f"> {message}"
            )
        return f"Notification: {event_type}"
