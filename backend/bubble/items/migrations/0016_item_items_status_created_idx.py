from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("items", "0015_migrate_book_shelves_to_locations"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="item",
            index=models.Index(
                fields=["status", "-created_at"],
                name="items_status_created_idx",
            ),
        ),
    ]
