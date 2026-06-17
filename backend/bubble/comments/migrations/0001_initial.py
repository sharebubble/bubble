import uuid

import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("items", "0013_historicalitem_ap_id_and_more"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Comment",
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
                    "body",
                    models.TextField(
                        help_text=(
                            "The comment text, e.g. a question or shared experience."
                        ),
                    ),
                ),
                (
                    "rating",
                    models.PositiveSmallIntegerField(
                        blank=True,
                        help_text="Optional star rating from 1 to 5.",
                        null=True,
                        validators=[
                            django.core.validators.MinValueValidator(1),
                            django.core.validators.MaxValueValidator(5),
                        ],
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "item",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="comments",
                        to="items.item",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="comments",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddConstraint(
            model_name="comment",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("rating__isnull", True),
                    models.Q(("rating__gte", 1), ("rating__lte", 5)),
                    _connector="OR",
                ),
                name="comments_rating_between_1_and_5",
            ),
        ),
    ]
