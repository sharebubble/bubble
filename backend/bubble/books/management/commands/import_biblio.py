"""Import a literature bibliography into the catalogue as book items.

Books are stored as :class:`~bubble.items.models.Item` records with
``category="books"``.  Book-specific metadata lives in ``Item.properties``
(JSONB): ``authors``, ``year``, ``publisher``, ``shelf``, ``topic``,
``isbn``, ``language`` etc.  See ``bubble.books.api.serializers``.

The command reads a structured JSON file (see ``books/data/biblio_books.json``)
produced from the source bibliography.  Each record carries a stable
``import_key`` so the command is **idempotent**: re-running it updates the
previously imported item instead of creating a duplicate.

Example::

    python manage.py import_biblio --user library
    python manage.py import_biblio --user library --status available
    python manage.py import_biblio --user library --dry-run --limit 20
"""

import json
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from bubble.items.models import (
    ConditionType,
    Item,
    ItemStatus,
    SalesType,
    VisibilityType,
)

User = get_user_model()

DEFAULT_DATA_FILE = Path(__file__).resolve().parents[2] / "data" / "biblio_books.json"

# Mark imported items so they can be found / cleaned up later.
IMPORT_SOURCE = "biblio-import"

STATUS_CHOICES = {
    "draft": ItemStatus.DRAFT,
    "available": ItemStatus.AVAILABLE,
}


class Command(BaseCommand):
    help = "Import a bibliography (JSON) as borrowable book items."

    def add_arguments(self, parser):
        parser.add_argument(
            "--user",
            required=True,
            help="Username that will own the imported book items.",
        )
        parser.add_argument(
            "--file",
            default=str(DEFAULT_DATA_FILE),
            help="Path to the bibliography JSON file.",
        )
        parser.add_argument(
            "--status",
            choices=sorted(STATUS_CHOICES),
            default="draft",
            help="Status of created items (default: draft).",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Only import the first N records (for testing).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Parse and report, but do not write to the database.",
        )

    def handle(self, *args, **options):
        try:
            owner = User.objects.get(username=options["user"])
        except User.DoesNotExist as exc:
            msg = f"User {options['user']!r} does not exist."
            raise CommandError(msg) from exc

        data_file = Path(options["file"])
        if not data_file.exists():
            msg = f"Data file not found: {data_file}"
            raise CommandError(msg)

        records = json.loads(data_file.read_text(encoding="utf-8"))
        if options["limit"] is not None:
            records = records[: options["limit"]]

        status = STATUS_CHOICES[options["status"]]
        dry_run = options["dry_run"]

        created = updated = skipped = 0
        with transaction.atomic():
            for record in records:
                if not record.get("import_key"):
                    skipped += 1
                    continue
                action = self._import_record(owner, record, status, dry_run)
                if action == "created":
                    created += 1
                elif action == "updated":
                    updated += 1
                else:
                    skipped += 1
            if dry_run:
                transaction.set_rollback(True)

        summary = (
            f"{'[dry-run] ' if dry_run else ''}"
            f"created={created} updated={updated} skipped={skipped} "
            f"(of {len(records)} records)"
        )
        self.stdout.write(self.style.SUCCESS(summary))

    def _import_record(self, owner, record, status, dry_run) -> str:
        """Create or update a single book item.  Returns the action taken."""
        title = (record.get("title") or record.get("raw_citation") or "").strip()
        if not title:
            return "skipped"

        properties = self._build_properties(record)
        description = self._build_description(record)
        import_key = record["import_key"]

        existing = (
            Item.objects.filter(
                user=owner,
                properties__source=IMPORT_SOURCE,
                properties__import_key=import_key,
            )
            .order_by("created_at")
            .first()
        )

        if dry_run:
            return "updated" if existing else "created"

        if existing:
            existing.name = title[:200]
            existing.description = description
            # Preserve any manually-added properties, override imported ones.
            merged = dict(existing.properties or {})
            merged.update(properties)
            existing.properties = merged
            existing.save()
            return "updated"

        Item.objects.create(
            user=owner,
            category="books",
            name=title[:200],
            description=description,
            sales_type=SalesType.BORROW,
            condition=ConditionType.USED,
            visibility=VisibilityType.AUTHENTICATED,
            status=status,
            properties=properties,
        )
        return "created"

    @staticmethod
    def _build_properties(record) -> dict:
        """Map a bibliography record onto Item.properties (book schema)."""
        shelf = (record.get("shelf") or "").strip()
        properties: dict = {
            "source": IMPORT_SOURCE,
            "import_key": record["import_key"],
            "authors": record.get("authors") or [],
            "publisher": (record.get("publisher") or "").strip(),
            "shelf": shelf,
            # The thematic shelf doubles as the topic for these items.
            "topic": shelf,
            "raw_citation": record.get("raw_citation", ""),
            "import_confidence": record.get("confidence", ""),
        }
        if record.get("year"):
            properties["year"] = record["year"]
        if (record.get("isbn") or "").strip():
            properties["isbn"] = record["isbn"].strip()
        if (record.get("language") or "").strip():
            properties["language"] = record["language"].strip()
        if record.get("editors"):
            properties["editors"] = True
        if (record.get("place") or "").strip():
            properties["place"] = record["place"].strip()
        if (record.get("subtitle") or "").strip():
            properties["subtitle"] = record["subtitle"].strip()
        return properties

    @staticmethod
    def _build_description(record) -> str:
        """Compose a human-readable description from subtitle and note."""
        parts = []
        if (record.get("subtitle") or "").strip():
            parts.append(record["subtitle"].strip())
        if (record.get("note") or "").strip():
            parts.append(record["note"].strip())
        return "\n\n".join(parts)
