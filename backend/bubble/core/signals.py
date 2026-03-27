"""Signal handlers for setting up default permissions and groups."""

import logging

from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from django.db.models.signals import post_migrate
from django.dispatch import receiver

from .permissions_config import DEFAULT_GROUPS_CONFIG

logger = logging.getLogger(__name__)


def create_default_groups_and_permissions():
    """Create default groups and assign permissions."""
    logger.debug("Creating default groups and permissions...")

    for group_name, group_config in DEFAULT_GROUPS_CONFIG.items():
        group, _created = Group.objects.get_or_create(name=group_name)

        # Clear existing permissions to ensure clean state
        group.permissions.clear()

        # Add permissions for each app/model
        permissions_config = group_config.get("permissions", {})
        for app_label, models_config in permissions_config.items():
            for model_name, permission_types in models_config.items():
                try:
                    content_type = ContentType.objects.get(
                        app_label=app_label, model=model_name.lower()
                    )

                    for perm_type in permission_types:
                        perm_codename = f"{perm_type}_{model_name.lower()}"

                        try:
                            permission = Permission.objects.get(
                                codename=perm_codename, content_type=content_type
                            )
                            group.permissions.add(permission)
                        except Permission.DoesNotExist:
                            logger.warning(
                                "Permission %s not found for %s.%s",
                                perm_codename,
                                app_label,
                                model_name,
                            )

                except ContentType.DoesNotExist:
                    logger.warning(
                        "ContentType not found for %s.%s", app_label, model_name
                    )


@receiver(post_migrate)
def setup_default_permissions(sender, **kwargs):
    """Set up default groups and permissions after migrations."""
    # Only run for specific apps to avoid running multiple times
    if sender.name in ["bubble.core"]:
        create_default_groups_and_permissions()
