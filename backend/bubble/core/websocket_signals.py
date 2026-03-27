"""Signals for WebSocket notifications."""

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.contrib.auth import user_logged_out
from django.contrib.sessions.models import Session
from django.db.models.signals import post_delete
from django.dispatch import receiver

logger = logging.getLogger(__name__)


@receiver(user_logged_out)
def notify_logout(sender, request, user, **kwargs):
    """Notify WebSocket clients when user logs out."""
    if user and user.is_authenticated:
        channel_layer = get_channel_layer()
        user_channel = f"user_{user.id}"

        # Send session invalidation message to all connections for this user
        async_to_sync(channel_layer.group_send)(
            user_channel,
            {
                "type": "session.invalidated",
                "reason": "User logged out",
            },
        )
        logger.info("Sent logout notification to user %s", user.username)


@receiver(post_delete, sender=Session)
def notify_session_delete(sender, instance, **kwargs):
    """Notify WebSocket clients when session is deleted."""
    try:
        # Decode session data to get user_id
        session_data = instance.get_decoded()
        user_id = session_data.get("_auth_user_id")

        if user_id:
            channel_layer = get_channel_layer()
            user_channel = f"user_{user_id}"

            # Send session invalidation message
            async_to_sync(channel_layer.group_send)(
                user_channel,
                {
                    "type": "session.invalidated",
                    "reason": "Session expired or deleted",
                },
            )
            logger.info("Sent session delete notification to user_id %s", user_id)
    except (KeyError, AttributeError, ValueError):
        logger.exception("Error sending session delete notification")


def send_user_notification(user_id: int, message: str, title: str | None = None):
    """
    Send a message notification to a specific user's WebSocket.

    Args:
        user_id: The ID of the user to notify
        message_data: Dictionary containing message details
    """
    channel_layer = get_channel_layer()
    user_channel = f"user_{user_id}"

    payload = {
        "type": "user.notification",
        "data": {
            "type": "notification",
            "data": {"message": message},
        },
    }
    if title is not None:
        payload["data"]["title"] = title

    async_to_sync(channel_layer.group_send)(user_channel, payload)


def send_message_notification(
    user_id: int, message: str, booking_uuid: str | None = None
):
    """
    Send a message notification to a specific user's WebSocket.

    Args:
        user_id: The ID of the user to notify
        message: The message text to display
        booking_uuid: Optional booking UUID to include in the notification
    """
    channel_layer = get_channel_layer()
    user_channel = f"user_{user_id}"

    data = {"message": message}
    if booking_uuid:
        data["booking"] = booking_uuid

    payload = {
        "type": "notification.message",
        "data": {"type": "new_message", "data": data},
    }
    async_to_sync(channel_layer.group_send)(user_channel, payload)
