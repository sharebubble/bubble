from django.apps import AppConfig


class ItemsConfig(AppConfig):
    name = "bubble.items"

    def ready(self):
        """Import signals when the app is ready."""
        import bubble.items.signals  # noqa: F401, PLC0415
