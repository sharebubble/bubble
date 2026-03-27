"""WebSocket consumer for real-time notifications."""

import json
import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.db import close_old_connections

logger = logging.getLogger(__name__)


class NotificationConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for user notifications.

    Handles:
    - User authentication via session
    - Personal notification channel per user
    - Session invalidation notifications
    - Message notifications
    """

    async def connect(self):
        """Accept WebSocket connection if user is authenticated."""
        # Get user from session
        self.user = self.scope.get("user")

        if self.user is None or not self.user.is_authenticated:
            logger.warning("Unauthenticated WebSocket connection attempt")
            await self.close()
            return

        # Create personal channel for this user
        self.user_channel = f"user_{self.user.id}"

        # Join user's personal notification group
        await self.channel_layer.group_add(self.user_channel, self.channel_name)

        await self.accept()
        logger.info("WebSocket connected for user %s", self.user.username)

        # Send connection confirmation
        await self.send(
            text_data=json.dumps(
                {
                    "type": "connection.established",
                    "user": self.user.username,
                    "user_id": str(self.user.id),
                }
            )
        )

    async def disconnect(self, close_code):
        """Leave notification group on disconnect."""
        if hasattr(self, "user_channel") and hasattr(self, "user"):
            await self.channel_layer.group_discard(self.user_channel, self.channel_name)
            logger.info(
                "WebSocket disconnected for user %s (code: %s)",
                self.user.username,
                close_code,
            )

        await database_sync_to_async(close_old_connections)()

    async def receive(self, text_data=None, bytes_data=None):
        """Handle messages from WebSocket (optional ping/pong)."""
        if text_data:
            try:
                data = json.loads(text_data)
                message_type = data.get("type")

                if message_type == "ping":
                    await self.send(
                        text_data=json.dumps(
                            {
                                "type": "pong",
                                "timestamp": data.get("timestamp"),
                            }
                        )
                    )
            except json.JSONDecodeError:
                logger.warning("Invalid JSON received: %s", text_data)

    # Handler methods for different notification types
    async def notification_message(self, event):
        """Send message notification to WebSocket."""
        await self.send(text_data=json.dumps(event["data"]))

    async def session_invalidated(self, event):
        """Notify client that session was invalidated."""
        await self.send(
            text_data=json.dumps(
                {
                    "type": "session.invalidated",
                    "reason": event.get("reason", "Session expired or logged out"),
                }
            )
        )
        # Close connection after sending notification
        await self.close()

    async def user_notification(self, event):
        """Generic user notification handler."""
        await self.send(text_data=json.dumps(event["data"]))
