from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class CoinsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "bubble.coins"
    verbose_name = _("Community coins")
