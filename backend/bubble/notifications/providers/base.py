from __future__ import annotations


class BaseNotificationProvider:
    """Abstract base class for notification providers."""

    provider_type: str

    def send(self, user_id: str, event_type: str, context: dict) -> bool:
        """Send a per-user notification. Returns True on success, False otherwise."""
        raise NotImplementedError

    def send_channel(self, event_type: str, context: dict) -> bool:
        """Send a channel-broadcast notification. Returns True on success."""
        raise NotImplementedError
