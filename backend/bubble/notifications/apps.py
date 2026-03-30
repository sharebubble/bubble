from django.apps import AppConfig


class NotificationsConfig(AppConfig):
    name = "bubble.notifications"

    def ready(self):
        """Import task definitions."""
        import bubble.notifications.tasks  # noqa: PLC0415, F401
