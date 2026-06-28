import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("items", "0013_historicalitem_ap_id_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="Location",
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
                    "name",
                    models.CharField(
                        help_text=(
                            "Name of the place, e.g. 'Sci-Fi shelf' or "
                            "'Shared workshop'."
                        ),
                        max_length=255,
                    ),
                ),
                (
                    "section",
                    models.CharField(
                        blank=True,
                        db_index=True,
                        help_text=(
                            "Optional grouping used to organise locations in the "
                            "picker, e.g. a library section or a building area."
                        ),
                        max_length=100,
                    ),
                ),
                (
                    "item_category",
                    models.CharField(
                        blank=True,
                        choices=[
                            ("books", "Books"),
                            ("clothing", "Clothing"),
                            ("electronics", "Electronics"),
                            ("furniture", "Furniture"),
                            ("garden", "Garden"),
                            ("kitchen", "Kitchen"),
                            ("other", "Other"),
                            ("rooms", "Rooms"),
                            ("sports", "Sports"),
                            ("tools", "Tools"),
                            ("toys", "Toys"),
                            ("vehicles", "Vehicles"),
                        ],
                        db_index=True,
                        help_text=(
                            "Restrict this location to a single item category. "
                            "Leave blank to make it available for items of any "
                            "category."
                        ),
                        max_length=100,
                    ),
                ),
                ("description", models.TextField(blank=True)),
                (
                    "sort_order",
                    models.PositiveIntegerField(
                        default=0,
                        help_text="Lower numbers are shown first within a section.",
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["item_category", "section", "sort_order", "name"],
            },
        ),
        migrations.AddConstraint(
            model_name="location",
            constraint=models.UniqueConstraint(
                fields=("item_category", "name"),
                name="unique_location_name_per_category",
                violation_error_message=(
                    "A location with this name already exists for this category."
                ),
            ),
        ),
        migrations.AddField(
            model_name="historicalitem",
            name="location",
            field=models.ForeignKey(
                blank=True,
                db_constraint=False,
                help_text=(
                    "Where the item is currently kept. Leave blank when the item "
                    "is at the owner's own place (the default)."
                ),
                null=True,
                on_delete=django.db.models.deletion.DO_NOTHING,
                related_name="+",
                to="items.location",
            ),
        ),
        migrations.AddField(
            model_name="item",
            name="location",
            field=models.ForeignKey(
                blank=True,
                help_text=(
                    "Where the item is currently kept. Leave blank when the item "
                    "is at the owner's own place (the default)."
                ),
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="items",
                to="items.location",
            ),
        ),
    ]
