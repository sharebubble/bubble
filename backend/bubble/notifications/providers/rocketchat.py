from __future__ import annotations

import logging

import httpx
from constance import config
from django.conf import settings
from django.utils import translation
from django.utils.translation import gettext as _

from bubble.users.models import User

from .base import BaseNotificationProvider

logger = logging.getLogger(__name__)


def _get_language_for_user(username: str | None) -> str:
    """Return the preferred language for *username*, falling back to LANGUAGE_CODE."""
    if not username:
        return settings.LANGUAGE_CODE
    try:
        user = User.objects.select_related("profile").get(username=username)
        lang = user.profile.language
        if lang:
            return lang
    except User.DoesNotExist:
        logger.warning("Could not find user %s for language lookup", username)
    return settings.LANGUAGE_CODE


class RocketChatProvider(BaseNotificationProvider):
    provider_type = "rocketchat"

    def send(self, user_id: str, event_type: str, context: dict) -> bool:
        """Send a per-user notification via the RocketChat webhook."""

        webhook_url: str = config.ROCKETCHAT_WEBHOOK_URL
        channel: str = config.ROCKETCHAT_CHANNEL

        if not webhook_url:
            logger.debug(
                "RocketChat webhook URL not configured, skipping notification."
            )
            return False

        lang = _get_language_for_user(user_id)
        with translation.override(lang):
            text = self._format_message(event_type, context)

        payload: dict = {"text": text}
        if channel:
            payload["channel"] = channel

        if config.ROCKETCHAT_USER_UNDERSCORES:
            user_id = user_id.replace(".", "_")

        return self._post(webhook_url, payload, user_id=user_id, event_type=event_type)

    def send_channel(self, event_type: str, context: dict) -> bool:
        """Send a channel-broadcast notification via the RocketChat webhook.

        Only posts when ROCKETCHAT_CHANNEL is non-empty.
        """

        webhook_url: str = config.ROCKETCHAT_WEBHOOK_URL
        channel: str = config.ROCKETCHAT_CHANNEL

        if not webhook_url:
            logger.debug(
                "RocketChat webhook URL not configured, skipping channel notification."
            )
            return False

        if not channel:
            logger.debug(
                "ROCKETCHAT_CHANNEL not set, skipping channel notification for %s.",
                event_type,
            )
            return False

        lang = settings.LANGUAGE_CODE
        with translation.override(lang):
            payload = self._build_channel_payload(event_type, context)
        payload["channel"] = channel

        return self._post(webhook_url, payload, event_type=event_type)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _post(
        self,
        webhook_url: str,
        payload: dict,
        *,
        user_id: str | None = None,
        event_type: str = "",
    ) -> bool:
        try:
            response = httpx.post(webhook_url, json=payload, timeout=10)
            logger.info(response.text)
            response.raise_for_status()
        except httpx.HTTPError:
            logger.exception(
                "Failed to send RocketChat notification (user=%s event=%s)",
                user_id,
                event_type,
            )
            return False
        else:
            logger.info(
                "RocketChat notification sent (user=%s event=%s)",
                user_id,
                event_type,
            )
            return True

    def _format_message(self, event_type: str, context: dict) -> str:
        if event_type == "new_message":
            booking_uuid = context.get("booking_uuid", "")
            message = context.get("message", "")
            item_title = context.get("item_title", "")
            return _(
                ":speech_balloon: New message in booking **%(item_title)s** "
                "`%(booking_uuid)s`:\n> %(message)s"
            ) % {
                "booking_uuid": booking_uuid,
                "message": message,
                "item_title": item_title,
            }
        return _("Notification: %(event_type)s") % {"event_type": event_type}

    def _build_channel_payload(self, event_type: str, context: dict) -> dict:
        if event_type == "new_item":
            return self._new_item_payload(context)
        return {"text": _("Notification: %(event_type)s") % {"event_type": event_type}}

    def _new_item_payload(self, context: dict) -> dict:
        title: str = context.get("name", _("New Item"))
        description: str = context.get("description", "")
        sales_type: str = context.get("sales_type", "")
        item_id: str = context.get("item_id", "")
        image_url: str = context.get("image_url", "")

        frontend_url: str = settings.FRONTEND_URL.rstrip("/")
        item_link = f"{frontend_url}/items/{item_id}" if frontend_url else ""

        # image_url from Django may be a relative /media/… path — make it absolute.
        if image_url and not image_url.startswith("http") and frontend_url:
            image_url = f"{frontend_url}{image_url}"

        sales_label = sales_type.replace("_", " ").capitalize() if sales_type else ""
        if sales_label:
            text = _("New item created for %(sales_label)s") % {
                "sales_label": sales_label
            }
        else:
            text = _("New item created")

        attachment: dict = {
            "title": title,
            "text": description,
        }
        if item_link:
            attachment["title_link"] = item_link
        if image_url:
            attachment["image_url"] = image_url

        return {"text": text, "attachments": [attachment]}
