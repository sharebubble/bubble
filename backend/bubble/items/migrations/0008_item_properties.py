"""Add properties JSONField to Item."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("items", "0007_alter_historicalitem_price_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="item",
            name="properties",
            field=models.JSONField(
                blank=True,
                null=True,
                help_text=(
                    "Category-specific properties stored as JSONB. "
                    "For books: isbn, language, year, topic, metadata, "
                    "authors, genres, publisher, shelf."
                ),
            ),
        ),
        migrations.AddField(
            model_name="historicalitem",
            name="properties",
            field=models.JSONField(
                blank=True,
                null=True,
                help_text=(
                    "Category-specific properties stored as JSONB. "
                    "For books: isbn, language, year, topic, metadata, "
                    "authors, genres, publisher, shelf."
                ),
            ),
        ),
    ]
