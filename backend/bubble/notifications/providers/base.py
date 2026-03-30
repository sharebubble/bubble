from __future__ import annotations


class BaseNotificationProvider:
    """Abstract base class for notification providers."""

    provider_type: str

    def send(self, user_id: str, event_type: str, context: dict) -> bool:
        """Send a notification. Returns True on success, False otherwise."""
        raise NotImplementedError
