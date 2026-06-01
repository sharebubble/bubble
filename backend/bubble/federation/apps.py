"""Federation app configuration."""

from django.apps import AppConfig


class FederationConfig(AppConfig):
    name = "bubble.federation"
    verbose_name = "Federation"

    def ready(self):
        """Import signal handlers when the app is ready."""
        import bubble.federation.signals  # noqa: F401, PLC0415
