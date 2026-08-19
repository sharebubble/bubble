# Bibliography import

Tools to bulk-import a literature bibliography (the _Soziale Bewegungen_
library list) into the catalogue as borrowable **book items**.

Books are not a separate model: they are `items.Item` records with
`category="books"`, and the book-specific metadata lives in `Item.properties`
(JSONB) — see `bubble/books/api/serializers.py`.

## Files

| File                | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `biblio_books.json` | Structured, ready-to-import records (one per book).  |
| `build_biblio.py`   | Regenerates `biblio_books.json` from the source ODT. |

## Record schema

Each record in `biblio_books.json`:

```json
{
  "import_key": "c2a435d3062b81ae", // stable id (sha1 of the raw citation)
  "title": "Die Aktualität der Arbeiterbewegung",
  "subtitle": "Beiträge zu ihrer Theorie und Geschichte",
  "authors": ["Abendroth, Wolfgang"],
  "editors": false,
  "year": 1985,
  "publisher": "Suhrkamp",
  "place": "Frankfurt am Main",
  "shelf": "KritTheorie", // normalised "Regal" / thematic shelf
  "isbn": "9783518113103", // empty unless enriched
  "language": "",
  "note": "",
  "confidence": "high", // high | medium | low (parse quality)
  "raw_citation": "Abendroth, Wolfgang (1985): Die Aktualität …"
}
```

`raw_citation` always preserves the original line, so nothing is lost and
low-confidence rows can be corrected by hand.

## Importing

```bash
# create the owning user first (or use an existing one), then:
python manage.py import_biblio --user library                 # status=draft
python manage.py import_biblio --user library --status available
python manage.py import_biblio --user library --dry-run       # report only
```

Items are created as `sales_type=borrow`, `condition=used`,
`visibility=authenticated`. The command is **idempotent**: it matches on
`properties.import_key`, so re-running updates existing items instead of
creating duplicates (manually edited properties such as a hand-added ISBN are
preserved).

## Enrichment (ISBN / cover)

The bibliography has no ISBNs. A handful of sample records in
`biblio_books.json` were enriched with a looked-up `isbn` to demonstrate the
flow. Once an item has an ISBN, the existing `ISBNLookupService`
(`bubble/books/services.py`, backed by the `isbn-search` container) can fill
in description, language, cover image, etc. from that ISBN.

## Regenerating the data

```bash
python build_biblio.py /path/to/sozialebewegungen_literaturbiblio.odt
```
