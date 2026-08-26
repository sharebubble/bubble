from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class LedgerConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "bubble.ledger"
    verbose_name = _("Ledger")
