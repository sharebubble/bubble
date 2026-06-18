"""Tests for the ``import_biblio`` management command."""

import json

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError

from bubble.items.models import Item, ItemStatus, SalesType, VisibilityType

User = get_user_model()

EXPECTED_RECORD_COUNT = 2
ABENDROTH_YEAR = 1985

SAMPLE_RECORDS = [
    {
        "import_key": "aaaa1111bbbb2222",
        "title": "Die Aktualität der Arbeiterbewegung",
        "subtitle": "Beiträge zu ihrer Theorie und Geschichte",
        "authors": ["Abendroth, Wolfgang"],
        "editors": False,
        "year": 1985,
        "publisher": "Suhrkamp",
        "place": "Frankfurt am Main",
        "shelf": "KritTheorie",
        "isbn": "9783518113103",
        "language": "",
        "note": "",
        "confidence": "high",
        "raw_citation": "Abendroth, Wolfgang (1985): Die Aktualität ...",
    },
    {
        "import_key": "cccc3333dddd4444",
        "title": "Caliban and the Witch",
        "subtitle": "Women, the Body and Primitive Accumulation",
        "authors": ["Federici, Silvia"],
        "editors": False,
        "year": 2012,
        "publisher": "Autonomedia",
        "place": "New York",
        "shelf": "",
        "isbn": "",
        "language": "",
        "note": "",
        "confidence": "high",
        "raw_citation": "Federici, Silvia (2012): Caliban and the Witch ...",
    },
]


@pytest.fixture
def data_file(tmp_path):
    path = tmp_path / "biblio_books.json"
    path.write_text(json.dumps(SAMPLE_RECORDS), encoding="utf-8")
    return path


@pytest.fixture
def owner(db):
    return User.objects.create_user(username="library", password="test12345")


@pytest.mark.django_db
class TestImportBiblio:
    def test_unknown_user_raises(self, data_file):
        with pytest.raises(CommandError):
            call_command("import_biblio", user="nobody", file=str(data_file))

    def test_creates_book_items(self, owner, data_file):
        call_command("import_biblio", user="library", file=str(data_file))

        items = Item.objects.filter(user=owner)
        assert items.count() == EXPECTED_RECORD_COUNT

        book = items.get(name="Die Aktualität der Arbeiterbewegung")
        assert book.category == "books"
        assert book.sales_type == SalesType.BORROW
        assert book.price is None
        assert book.visibility == VisibilityType.AUTHENTICATED
        assert book.status == ItemStatus.DRAFT
        assert book.properties["authors"] == ["Abendroth, Wolfgang"]
        assert book.properties["year"] == ABENDROTH_YEAR
        assert book.properties["isbn"] == "9783518113103"
        assert book.properties["shelf"] == "KritTheorie"
        assert book.properties["topic"] == "KritTheorie"
        assert book.properties["source"] == "biblio-import"
        # subtitle flows into the description
        assert "Beiträge zu ihrer Theorie" in book.description

    def test_status_available(self, owner, data_file):
        call_command(
            "import_biblio", user="library", file=str(data_file), status="available"
        )
        assert all(
            item.status == ItemStatus.AVAILABLE
            for item in Item.objects.filter(user=owner)
        )

    def test_idempotent_rerun_updates(self, owner, data_file):
        call_command("import_biblio", user="library", file=str(data_file))
        # Re-running must not create duplicates.
        call_command("import_biblio", user="library", file=str(data_file))
        assert Item.objects.filter(user=owner).count() == EXPECTED_RECORD_COUNT

    def test_rerun_preserves_manual_properties(self, owner, data_file):
        call_command("import_biblio", user="library", file=str(data_file))
        book = Item.objects.get(name="Caliban and the Witch")
        book.properties = {**book.properties, "isbn": "9781570270598"}
        book.save()

        call_command("import_biblio", user="library", file=str(data_file))
        book.refresh_from_db()
        # Manually-added ISBN is preserved because the record has none.
        assert book.properties["isbn"] == "9781570270598"

    def test_dry_run_writes_nothing(self, owner, data_file):
        call_command("import_biblio", user="library", file=str(data_file), dry_run=True)
        assert Item.objects.filter(user=owner).count() == 0

    def test_limit(self, owner, data_file):
        call_command("import_biblio", user="library", file=str(data_file), limit=1)
        assert Item.objects.filter(user=owner).count() == 1
