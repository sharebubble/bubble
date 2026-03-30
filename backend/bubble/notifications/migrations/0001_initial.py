from __future__ import annotations

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="NotificationPreference",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "provider_type",
                    models.CharField(
                        choices=[("rocketchat", "RocketChat"), ("email", "Email")],
                        max_length=50,
                        verbose_name="provider type",
                    ),
                ),
                (
                    "event_type",
                    models.CharField(
                        choices=[("new_message", "New Message")],
                        max_length=50,
                        verbose_name="event type",
                    ),
                ),
                (
                    "enabled",
                    models.BooleanField(default=False, verbose_name="enabled"),
                ),
                (
                    "created_at",
                    models.DateTimeField(auto_now_add=True, verbose_name="created at"),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="notification_preferences",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="user",
                    ),
                ),
            ],
            options={
                "verbose_name": "Notification Preference",
                "verbose_name_plural": "Notification Preferences",
            },
        ),
        migrations.AlterUniqueTogether(
            name="notificationpreference",
            unique_together={("user", "provider_type", "event_type")},
        ),
    ]
