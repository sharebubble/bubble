from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class CollectionsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "bubble.collections"
    verbose_name = _("Collections")

    def ready(self):
        import bubble.collections.signals  # noqa: F401, PLC0415
