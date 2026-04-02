from __future__ import annotations

import logging

from django.db import migrations

logger = logging.getLogger(__name__)

PROVIDER_ROCKETCHAT = "rocketchat"
EVENT_NEW_MESSAGE = "new_message"


def enable_rocketchat_for_existing_users(apps, schema_editor):
    """Create an enabled RocketChat new_message preference for every user
    that does not already have one, but only when ROCKETCHAT_WEBHOOK_URL is set."""

    try:
        from constance import config  # noqa: PLC0415

        webhook_url = config.ROCKETCHAT_WEBHOOK_URL
    except Exception:
        logger.warning(
            "Could not read ROCKETCHAT_WEBHOOK_URL from constance — "
            "skipping backfill of notification preferences."
        )
        return

    if not webhook_url:
        logger.info(
            "ROCKETCHAT_WEBHOOK_URL is empty — "
            "skipping backfill of notification preferences."
        )
        return

    User = apps.get_model("users", "User")
    NotificationPreference = apps.get_model("notifications", "NotificationPreference")

    existing_user_ids = set(
        NotificationPreference.objects.filter(
            provider_type=PROVIDER_ROCKETCHAT,
            event_type=EVENT_NEW_MESSAGE,
        ).values_list("user_id", flat=True)
    )

    to_create = [
        NotificationPreference(
            user=user,
            provider_type=PROVIDER_ROCKETCHAT,
            event_type=EVENT_NEW_MESSAGE,
            enabled=True,
        )
        for user in User.objects.exclude(pk__in=existing_user_ids)
    ]

    if to_create:
        NotificationPreference.objects.bulk_create(to_create)
        logger.info(
            "Created RocketChat new_message preferences for %d existing users.",
            len(to_create),
        )


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("notifications", "0001_initial"),
        ("users", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(
            enable_rocketchat_for_existing_users,
            reverse_code=noop,
        ),
    ]
