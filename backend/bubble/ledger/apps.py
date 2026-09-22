from django.apps import AppConfig


class LedgerConfig(AppConfig):
    name = "bubble.ledger"
    verbose_name = "Ledger"

    def ready(self):
        from bubble.ledger import signals  # noqa: F401, PLC0415
