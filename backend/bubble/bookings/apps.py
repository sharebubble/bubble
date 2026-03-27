from django.apps import AppConfig


class BookingsConfig(AppConfig):
    name = "bubble.bookings"

    def ready(self):
        """Import signal handlers and task definitions."""
        import bubble.bookings.signals  # noqa: PLC0415
        import bubble.bookings.tasks  # noqa: PLC0415, F401
