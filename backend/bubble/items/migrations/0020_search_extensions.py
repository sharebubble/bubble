"""Install the PostgreSQL extensions the item search relies on.

``unaccent`` folds diacritics so "fahrrader" finds "Fahrräder", and ``pg_trgm``
supplies the word-similarity operator behind typo-tolerant title matching.
Both are *trusted* extensions on PostgreSQL 13+, so the database owner can
install them without superuser rights.
"""

from django.contrib.postgres.operations import TrigramExtension, UnaccentExtension
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("items", "0019_alter_historicalitem_status_alter_item_status"),
    ]

    operations = [
        UnaccentExtension(),
        TrigramExtension(),
    ]
