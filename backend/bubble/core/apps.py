from django.apps import AppConfig


class CoreConfig(AppConfig):
    name = "bubble.core"

    def ready(self):
        """Import signal handlers when the app is ready."""
        import bubble.core.signals  # noqa: PLC0415
        import bubble.core.websocket_signals  # noqa: F401, PLC0415
