# Item search: matching, ranking and what to do next

Search is how most people get to an item, so this doc records how the current
implementation works, why it works that way, and which improvements are worth
picking up next.

The implementation lives in `backend/bubble/items/api/search.py` and is shared by
every endpoint that accepts a `search` query parameter:

| Endpoint | Fields matched |
| --- | --- |
| `api:public-item-list` (`/api/public-items/`) | title, description |
| `api:item-list` (`/api/items/`) | title, description |
| `api:public-item-facets` (`/api/public-items/facets/`) | title, description |
| `api:federated-item-list` (`/api/federated-items/`) | title, description (local **and** remote items) |
| `api:book-list` (`/api/books/`) | title, description, ISBN, author, publisher, topic |

---

## 1. What changed

Previously every endpoint ran the same query: `name ILIKE %q% OR description ILIKE %q%`,
returning matches newest-first. Two consequences:

- An item **named** "Ladder" and an item whose description happens to end with
  "…store it next to the ladder" were equally good hits, and the newer one won.
- A two-word query was matched as one literal string, so "ladder aluminium"
  found nothing unless those words appeared adjacent, in that order.

### Matching

The query is parsed into terms; `"quoted phrases"` stay together as one term and
at most `MAX_SEARCH_TERMS` (8) terms are used. **Every** term has to be found, in
any of the searched fields — terms are ANDed, fields are ORed. So "ladder
aluminium" now finds *Aluminium step ladder*, and adding a word narrows results
instead of emptying them.

Facet counts use the exact same matcher, so the number on a facet chip always
matches the number of results you get by clicking it.

### Ranking

Each row is scored, and higher scores come first:

| Signal | Weight |
| --- | --- |
| Title is exactly the query | 100 |
| Title starts with the query | 50 |
| Title contains the query | 25 |
| Description contains the query | 10 |
| *per term:* term in title | 8 |
| *per term:* term in an extra field (ISBN, author, …) | 4 |
| *per term:* term in description | 2 |

The tiers are additive, so an exact title match scores 100 + 50 + 25 + 8 = 183
while a description-only hit scores 12. Anything matching in the title outranks
everything matching only in the description — which is the property the ranking
exists for. Ties fall back to the endpoint's default ordering (newest first), so
pagination stays stable.

Two implementations share those weights: `relevance_annotation` builds a SQL
expression for querysets, and `relevance_score` scores a row in Python for the
federated endpoint, which merges local and remote rows in memory and so cannot
sort them in the database. **They must stay in sync.**

### Ordering

`?ordering=relevance` sorts best-match-first, and is the **default whenever a
search term is present**. Any explicit `ordering` (`name`, `-price`,
`-created_at`, …) still wins, and `relevance` is ignored when no search is
active, since there is nothing to rank. The browse page adds a "Relevance" entry
to its sort menu that only appears while a term is active.

### Why substring matching, not full-text search

PostgreSQL full-text search (`SearchVector`/`SearchRank`) was considered and not
adopted *yet*. `tsvector` matching is lexeme-based: it would stop "saw" from
finding "Chainsaw" and stop "9780441" from finding a full ISBN — both things
people do here, on a catalogue whose titles are short, multilingual, and full of
model numbers. Substring matching keeps those working. The cost is that ranking
signals stay coarse and matching cannot handle typos; see below.

---

## 2. Suggested next steps

Roughly in order of value per unit of work.

### 2.1 Typo tolerance with `pg_trgm` (high value)

`CREATE EXTENSION pg_trgm` plus a `TrigramSimilarity` annotation would make
"laddr" find *Ladder*, and a GIN trigram index on `items_item.name` would
additionally make the current `ILIKE %…%` title matching index-backed rather
than a sequential scan. Suggested shape: keep the strict match as-is, and fall
back to `similarity(name, query) > 0.3` when it returns nothing, so fuzzy hits
never dilute exact ones. Needs a migration with `TrigramExtension()`, so check
that the deploy database user may create extensions.

### 2.2 Accent and case folding with `unaccent` (high value, small)

"Fahrrader" does not currently find *Fahrräder*, and for a German-language
instance that is a common miss. `CREATE EXTENSION unaccent` plus an
`unaccent(lower(name))` functional index fixes it for both matching and ranking.

### 2.3 A word-boundary ranking tier (small)

Right now "cat" scores *Catalogue* and *Cat carrier* identically. A
`name__iregex=r"\y<term>\y"` tier (PostgreSQL word boundaries) between "title
contains" and "title starts with" would separate them. Cheap to add to the
weight table; costs one regex per row over the already-filtered set.

### 2.4 Search more fields (small, needs a product call)

Category, owner name and collection name are currently *facets* but not
searchable text, so typing "tools" into the box matches only items with the word
in their title or description, not the whole category. Adding them to the matched
fields (at a weight between title and description) would make the box work the
way people expect. It does widen result sets, hence the product call.

### 2.5 Highlight the matched terms in results (medium)

The ranking knows *why* an item matched but the UI never says so. Marking the
matched terms in the title/description snippet — and, where the hit was
description-only, showing that snippet instead of the first line — would make the
ordering legible instead of mysterious.

### 2.6 Recent and suggested searches (medium)

The header popup already loads facets while the user types. Adding a short list
of the viewer's recent searches (localStorage) and the top matching item titles
as type-ahead suggestions would cut the number of dead-end queries. Worth
watching the facets request count if this goes in.

### 2.7 Empty-state recovery (small)

A query with no results currently shows an empty grid. Better: drop the last
term and re-run ("no results for *ladder aluminium 3m* — showing results for
*ladder aluminium*"), which is a natural fit for the AND-ed term list.

### 2.8 Instrument it (small, unlocks everything else)

None of the above can be prioritised with evidence today, because queries are not
logged. Recording `(query, result count, whether a result was opened)` — no user
id needed — would show the real zero-result and no-click queries, and is the
cheapest way to find out which of 2.1–2.7 actually matters here.

---

## 3. Tests

| File | Covers |
| --- | --- |
| `backend/bubble/items/tests/test_search.py` | Query parsing (quoting, dedup, term cap), the Python scorer, list ranking, explicit-ordering override, facet/list agreement, federated ranking |
| `backend/bubble/books/tests/test_search.py` | Book ranking and JSONB metadata matching (ISBN, author) |
