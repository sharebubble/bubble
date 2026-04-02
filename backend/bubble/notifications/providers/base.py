from __future__ import annotations


class BaseNotificationProvider:
    """Abstract base class for notification providers."""

    provider_type: str

    def send(
        self,
        event_type: str,
        context: dict,
        *,
        user_id: str | None = None,
    ) -> bool:
        """Send a notification.

        When *user_id* is provided, the notification is directed to that user.
        When omitted, the notification is broadcast to the default channel.
        Returns True on success, False otherwise.
        """
        raise NotImplementedError
