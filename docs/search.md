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

All of them fold accents on both sides of the comparison, and all of them apply
the approximate (typo-tolerant) pass to the **title** only. The book metadata is
matched literally: those are JSONB paths, where Django reads an `unaccent`
transform as one more key in the document rather than as a function call.

---

## 1. What changed

Previously every endpoint ran the same query: `name ILIKE %q% OR description ILIKE %q%`,
returning matches newest-first. Three consequences:

- An item **named** "Ladder" and an item whose description happens to end with
  "…store it next to the ladder" were equally good hits, and the newer one won.
- A two-word query was matched as one literal string, so "ladder aluminium"
  found nothing unless those words appeared adjacent, in that order.
- A diacritic or a typo was fatal: "fahrrader" missed *Fahrräder* entirely, and
  a listing spelled *Bohrmaschiene* was unreachable.

### Matching

The query is parsed into terms; `"quoted phrases"` stay together as one term and
at most `MAX_SEARCH_TERMS` (8) terms are used. **Every** term has to be found, in
any of the searched fields — terms are ANDed, fields are ORed. So "ladder
aluminium" now finds *Aluminium step ladder*, and adding a word narrows results
instead of emptying them.

Every comparison folds diacritics through PostgreSQL's `unaccent`, on both the
column and the term, so "fahrrader" finds *Fahrräder* and "Fahrräder" finds
*Fahrrader*. A term that matches nothing literally gets a second, approximate
pass against the **title** using `pg_trgm`'s word similarity, so
"bohrmaschiene" still finds *Bohrmaschine*. Both extensions are installed by
`items` migration `0020_search_extensions`; they are *trusted* on PostgreSQL 13+,
so the database owner can create them without superuser rights.

Facet counts use the exact same matcher, so the number on a facet chip always
matches the number of results you get by clicking it.

#### Calibrating the fuzzy pass

`word_similarity(term, title)` scores the term against the best-matching run of
words in the title. Measured against realistic German/English listings:

| Term / title | Score |
| --- | --- |
| bohrmaschine / Bohrmaschiene | 0.77 |
| kinderwagen / Kinderwagn | 0.75 |
| gitarre / Gitare | 0.67 |
| projektor / Projecktor | 0.62 |
| hammer / Hammar drill | 0.57 |
| leiter / Leitre | 0.57 |
| **threshold** | **0.55** |
| drucker / Druker | 0.50 |
| tisch / Fisch Eimer | 0.50 |
| law / Ladder | 0.50 |
| leiter / Liter Flasche | 0.44 |

`FUZZY_SIMILARITY_THRESHOLD = 0.55` sits in the gap between one-letter slips in
words of six characters or more and the coincidental matches below. Two terms
never get the fuzzy pass at all (`is_fuzzy_matchable`):

- **Shorter than `MIN_FUZZY_TERM_LENGTH` (5).** At that length one different
  character is usually a different word — "law" scores 0.50 against *Ladder*.
- **Quoted phrases.** Asking for a phrase is already an instruction to take the
  spelling literally.

Only the title is matched fuzzily. A typo-tolerant description match pulls in
far more than it rescues.

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
| *per term:* term merely *similar* to the title | 1 |

The tiers are additive, so an exact title match scores 100 + 50 + 25 + 8 + 1 =
184 while a description-only hit scores 12 and a rescued typo scores 1. Anything
matching in the title outranks everything matching only in the description —
which is the property the ranking exists for — and an approximate match ranks
below both, so typo tolerance extends the result list downwards instead of
reshuffling it. Ties fall back to the endpoint's default ordering (newest
first), so pagination stays stable.

Two implementations share those weights: `relevance_annotation` builds a SQL
expression for querysets, and `relevance_score` scores a row in Python for the
federated endpoint, which merges local and remote rows in memory and so cannot
sort them in the database. **They must stay in sync.** The Python side has no
fuzzy tier — that needs PostgreSQL — so a federated row rescued by a typo scores
0 and lands at the bottom of that list, which is where its one point would have
put it anyway. Its `strip_accents` helper mirrors `unaccent` for the European
letters; the SQL path, which calls `unaccent` itself, is what decides inclusion.

### Ordering

`?ordering=relevance` sorts best-match-first, and is the **default whenever a
search term is present**. Any explicit `ordering` (`name`, `-price`,
`-created_at`, …) still wins, and `relevance` is ignored when no search is
active, since there is nothing to rank. Rank on its own never ends the sort:
whether relevance was requested or applied by default, the endpoint's own
ordering follows it to settle ties, so equally-ranked rows cannot drift between
pages. The browse page adds a "Relevance" entry
to its sort menu that only appears while a term is active.

### Why substring matching, not full-text search

PostgreSQL full-text search (`SearchVector`/`SearchRank`) was considered and not
adopted *yet*. `tsvector` matching is lexeme-based: it would stop "saw" from
finding "Chainsaw" and stop "9780441" from finding a full ISBN — both things
people do here, on a catalogue whose titles are short, multilingual, and full of
model numbers. Substring matching keeps those working, and `pg_trgm` covers the
typo tolerance that would otherwise be the main argument for switching. The cost
is that ranking signals stay coarse: there is no term-frequency or field-length
normalisation, only the tier table above.

---

## 2. Suggested next steps

Roughly in order of value per unit of work.

### 2.1 Index the search columns (small, do it when the catalogue grows)

Every comparison wraps the column in `unaccent(…)`, so no plain index on `name`
or `description` can serve it, and each search is a sequential scan. On a
neighbourhood catalogue (thousands of rows) that is fine and no index was added.
When it stops being fine, the fix is a functional GIN trigram index — which needs
an `IMMUTABLE` wrapper, because `unaccent` itself is not:

```sql
CREATE FUNCTION immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

CREATE INDEX items_item_name_trgm
  ON items_item USING gin (immutable_unaccent(name) gin_trgm_ops);
```

The catch: Django's `__unaccent` lookup emits `UNACCENT(…)`, not
`immutable_unaccent(…)`, so the index is only used once a custom `Transform` is
registered to emit the wrapper. Measure first — `EXPLAIN ANALYZE` on a real
search — before taking that on.

### 2.2 Tune the fuzzy threshold against real queries (small)

`FUZZY_SIMILARITY_THRESHOLD` (0.55) and `MIN_FUZZY_TERM_LENGTH` (5) were
calibrated against invented typos, not observed ones. Once §2.8 is in place,
recheck them against queries that actually returned nothing.

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
| `backend/bubble/items/tests/test_search.py` | Query parsing (quoting, dedup, term cap), the Python scorer and accent fold, fuzzy eligibility, list ranking, explicit-ordering override, accent-insensitive search, typo tolerance and its ranking, facet/list agreement, federated ranking |
| `backend/bubble/books/tests/test_search.py` | Book ranking and JSONB metadata matching (ISBN, author) |
