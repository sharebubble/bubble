"""Backfill the new Location FK from the legacy free-text book shelf.

Books used to store their shelf as a plain string in
``Item.properties["shelf"]``.  Now that placements are modelled as proper
``Location`` rows, create one location per distinct shelf name (scoped to the
``books`` category) and point each book at it.  The original string is left in
``properties`` untouched, so this migration is non-destructive.
"""

from django.db import migrations


def forwards(apps, schema_editor):
    Item = apps.get_model("items", "Item")
    Location = apps.get_model("items", "Location")
    db = schema_editor.connection.alias

    cache = {}
    books = Item.objects.using(db).filter(category="books").exclude(
        properties__isnull=True
    )
    for item in books.iterator():
        props = item.properties or {}
        raw = props.get("shelf")
        name = raw.strip() if isinstance(raw, str) else ""
        if not name:
            continue

        key = name.casefold()
        location = cache.get(key)
        if location is None:
            location, _ = Location.objects.using(db).get_or_create(
                item_category="books",
                name=name,
            )
            cache[key] = location

        if item.location_id != location.id:
            item.location_id = location.id
            item.save(using=db, update_fields=["location"])


class Migration(migrations.Migration):

    dependencies = [
        ("items", "0014_location_and_item_location"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
