"""Relevance-ranked free-text search over items.

The search box is the main way people find things, so a match in an item's
*title* must outrank a match that only appears somewhere in its description.
This module holds the two halves of that behaviour:

``search_filter_q``
    Which items match. The query is split into terms (with ``"quoted
    phrases"`` kept together) and **every** term has to appear in at least one
    of the searched fields, so "blue bike" finds "Bike, blue frame" instead of
    only the literal phrase.

``relevance_annotation`` / ``relevance_score``
    How well they match. Both implement the same weighting — the first as a
    database expression for querysets, the second in Python for the federated
    endpoint, which merges local and remote rows in memory and therefore
    cannot sort them in SQL. Keep the two in sync; the shared weight constants
    below are what they are built from.

Matching stays substring-based (``ILIKE %term%``) rather than moving to
PostgreSQL full-text search: item titles are short, frequently multilingual
and full of model numbers ("AEG L6FB"), where stemming and dictionary lookups
help less than a plain substring match — and lexeme matching would stop "saw"
from finding "Chainsaw". Two PostgreSQL extensions close the gaps that leaves
(both installed by ``items`` migration 0020):

``unaccent``
    Every comparison folds diacritics on both sides, so "fahrrader" finds
    *Fahrräder* and "Fahrräder" finds an item someone typed as "Fahrraeder".

``pg_trgm``
    A term that matches nothing literally still matches a title it is merely
    *similar* to, so "bohrmaschiene" finds *Bohrmaschine*. Fuzzy hits score
    below every literal one, so they extend the results rather than reorder
    them.

``docs/search.md`` records the trade-off and the calibration behind the
thresholds.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from django.contrib.postgres.lookups import Unaccent
from django.contrib.postgres.search import TrigramWordSimilarity
from django.db.models import Case, IntegerField, Q, QuerySet, Value, When
from django.db.models.lookups import GreaterThanOrEqual
from rest_framework import filters

# Matching/ranking is capped so a pathological query ("a b c d e …") cannot
# turn into an unbounded number of ILIKE and similarity comparisons per row.
MAX_SEARCH_TERMS = 8

# Score contributions, highest first. A title hit is worth more than a
# description hit at every tier, which is the whole point of the ranking: an
# item called "Ladder" beats one whose description merely mentions a ladder.
WEIGHT_NAME_EXACT = 100  # the title *is* the query
WEIGHT_NAME_PREFIX = 50  # the title starts with the query
WEIGHT_NAME_PHRASE = 25  # the title contains the query verbatim
WEIGHT_DESCRIPTION_PHRASE = 10  # the description contains the query verbatim
WEIGHT_NAME_TERM = 8  # per query term found in the title
WEIGHT_EXTRA_TERM = 4  # per query term found in an extra field (e.g. ISBN)
WEIGHT_DESCRIPTION_TERM = 2  # per query term found in the description
WEIGHT_NAME_FUZZY = 1  # per query term merely *similar* to the title

# Typo tolerance, calibrated against realistic German/English item titles (the
# numbers behind these are in docs/search.md). `word_similarity` compares the
# term against the best-matching run of words in the title, so 0.55 catches a
# one-letter slip in "bohrmaschiene" while leaving "tisch"/"Fisch Eimer" (0.5)
# out. Terms shorter than five characters are never matched fuzzily: at that
# length a single character's difference is usually a different word.
FUZZY_SIMILARITY_THRESHOLD = 0.55
MIN_FUZZY_TERM_LENGTH = 5

# PostgreSQL's `unaccent` folds a handful of letters that Unicode decomposition
# leaves alone (they have no combining-mark form). Only the European letters
# are listed: this table backs the in-memory scorer for the federated list,
# where a small mismatch shifts a row's rank but never its inclusion — the SQL
# path, which calls `unaccent` itself, is what decides that.
_UNACCENT_EXTRAS = str.maketrans(
    {
        "ß": "ss",
        "æ": "ae",
        "Æ": "AE",
        "œ": "oe",
        "Œ": "OE",
        "ø": "o",
        "Ø": "O",
        "ð": "d",
        "Ð": "D",
        "þ": "th",
        "Þ": "TH",
        "đ": "d",
        "Đ": "D",
        "ł": "l",
        "Ł": "L",
        "\u0131": "i",  # dotless i, spelled out to keep the lint quiet
    }
)

# `"…"` keeps a phrase together; anything else is split on whitespace.
_TERM_RE = re.compile(r'"([^"]+)"|(\S+)')


@dataclass(frozen=True)
class SearchQuery:
    """A parsed search query: the whole phrase plus its individual terms."""

    phrase: str
    terms: tuple[str, ...]

    def __bool__(self) -> bool:
        return bool(self.terms)


def parse_search_query(value: str | None) -> SearchQuery:
    """Split raw user input into a phrase and its individual terms.

    Double-quoted runs are kept together as a single term so ``"drill press"``
    can be searched as one unit. Terms beyond ``MAX_SEARCH_TERMS`` are dropped.
    """
    phrase = (value or "").strip()
    if not phrase:
        return SearchQuery(phrase="", terms=())

    terms: list[str] = []
    for quoted, bare in _TERM_RE.findall(phrase):
        term = (quoted or bare).strip()
        if term and term not in terms:
            terms.append(term)

    return SearchQuery(phrase=phrase, terms=tuple(terms[:MAX_SEARCH_TERMS]))


def strip_accents(value: str) -> str:
    """Fold diacritics the way PostgreSQL's ``unaccent`` does.

    Used only by :func:`relevance_score`; every database comparison calls
    ``unaccent`` itself on both sides.
    """
    decomposed = unicodedata.normalize("NFKD", value.translate(_UNACCENT_EXTRAS))
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def is_fuzzy_matchable(term: str) -> bool:
    """Whether ``term`` should also be matched approximately.

    Short terms are excluded because at that length one different character is
    usually a different word, and quoted phrases because asking for a phrase is
    already an instruction to take the spelling literally.
    """
    return len(term) >= MIN_FUZZY_TERM_LENGTH and " " not in term


def fuzzy_name_q(term: str) -> Q:
    """Match titles similar enough to ``term`` to be a plausible typo.

    Only the title is matched fuzzily. A typo-tolerant description match would
    pull in far more than it rescues, and the title is what people type.
    """
    return Q(
        GreaterThanOrEqual(
            TrigramWordSimilarity(Unaccent(Value(term)), Unaccent("name")),
            Value(FUZZY_SIMILARITY_THRESHOLD),
        )
    )


def search_filter_q(
    query: SearchQuery,
    *,
    extra_fields: tuple[str, ...] = (),
) -> Q:
    """Return the ``Q`` matching every term in name, description or extras.

    Terms are ANDed and fields are ORed: an item matches when each term is
    found somewhere, not necessarily all in the same field. Long enough terms
    also match titles they are merely similar to, which is what makes a
    mistyped query return anything at all.

    ``extra_fields`` are compared without ``unaccent``: today they are JSONB
    paths (``properties__isbn``), where Django would read the transform as one
    more key in the document rather than as a function call.
    """
    combined = Q()
    for term in query.terms:
        term_q = Q(name__unaccent__icontains=term) | Q(
            description__unaccent__icontains=term
        )
        for field in extra_fields:
            term_q |= Q(**{f"{field}__icontains": term})
        if is_fuzzy_matchable(term):
            term_q |= fuzzy_name_q(term)
        combined &= term_q
    return combined


def _when(condition: Q, weight: int) -> Case:
    """A single additive scoring tier: ``weight`` when ``condition`` holds."""
    return Case(
        When(condition, then=Value(weight)),
        default=Value(0),
        output_field=IntegerField(),
    )


def relevance_annotation(
    query: SearchQuery,
    *,
    extra_fields: tuple[str, ...] = (),
):
    """Build the database expression scoring how well a row matches ``query``.

    Mirrors :func:`relevance_score`; see the weight constants above.
    """
    phrase = query.phrase
    expression = (
        _when(Q(name__unaccent__iexact=phrase), WEIGHT_NAME_EXACT)
        + _when(Q(name__unaccent__istartswith=phrase), WEIGHT_NAME_PREFIX)
        + _when(Q(name__unaccent__icontains=phrase), WEIGHT_NAME_PHRASE)
        + _when(Q(description__unaccent__icontains=phrase), WEIGHT_DESCRIPTION_PHRASE)
    )

    # Per-term credit, so a two-of-three-terms title still outranks a
    # description that happens to contain the full phrase's words.
    for term in query.terms:
        expression = (
            expression
            + _when(Q(name__unaccent__icontains=term), WEIGHT_NAME_TERM)
            + _when(Q(description__unaccent__icontains=term), WEIGHT_DESCRIPTION_TERM)
        )
        for field in extra_fields:
            expression = expression + _when(
                Q(**{f"{field}__icontains": term}), WEIGHT_EXTRA_TERM
            )
        # Worth one point: enough to sort a rescued typo above the rows that
        # matched nothing, far below anything that matched literally.
        if is_fuzzy_matchable(term):
            expression = expression + _when(fuzzy_name_q(term), WEIGHT_NAME_FUZZY)

    return expression


def relevance_score(query: SearchQuery, name: str, description: str) -> int:
    """Score an in-memory row as :func:`relevance_annotation` scores a database row.

    Two tiers have no counterpart here. ``extra_fields`` does not apply — the
    only in-memory caller is the federated list, and remote items carry no
    metadata beyond title and description — and neither does the fuzzy tier,
    which needs PostgreSQL. A row rescued by a typo therefore scores zero and
    lands at the bottom of that list, which is where its one point would have
    put it anyway.
    """
    name = strip_accents(name or "").lower()
    description = strip_accents(description or "").lower()
    phrase = strip_accents(query.phrase).lower()

    score = 0
    if name == phrase:
        score += WEIGHT_NAME_EXACT
    if name.startswith(phrase):
        score += WEIGHT_NAME_PREFIX
    if phrase in name:
        score += WEIGHT_NAME_PHRASE
    if phrase in description:
        score += WEIGHT_DESCRIPTION_PHRASE

    for term in query.terms:
        lowered = strip_accents(term).lower()
        if lowered in name:
            score += WEIGHT_NAME_TERM
        if lowered in description:
            score += WEIGHT_DESCRIPTION_TERM

    return score


def ranked_search(
    queryset: QuerySet,
    value: str | None,
    *,
    extra_fields: tuple[str, ...] = (),
) -> QuerySet:
    """Filter ``queryset`` by ``value`` and annotate it with ``search_rank``.

    The annotation is what ``?ordering=relevance`` (and the search-aware
    default ordering) sorts on. An empty query leaves the queryset untouched
    and unannotated — callers must not order by ``search_rank`` unless a
    search is active.
    """
    query = parse_search_query(value)
    if not query:
        return queryset

    return queryset.filter(search_filter_q(query, extra_fields=extra_fields)).annotate(
        search_rank=relevance_annotation(query, extra_fields=extra_fields),
    )


class RelevanceOrderingFilter(filters.OrderingFilter):
    """``OrderingFilter`` that understands ``relevance`` and prefers it.

    ``?ordering=relevance`` sorts the best matches first and ``-relevance``
    reverses that. When a search is active and the client asked for no
    particular order, relevance leads and the viewset's own default ordering
    breaks ties, so equally-relevant items still come back newest-first (and
    pagination stays stable).

    Without an active search there is nothing to rank, so a ``relevance`` term
    is dropped rather than raising on the missing annotation.
    """

    relevance_param = "relevance"

    def get_ordering(self, request, queryset, view):
        ordering = super().get_ordering(request, queryset, view)
        is_search = "search_rank" in queryset.query.annotations

        # No explicit `ordering=` while searching → rank first, default second.
        if is_search and not request.query_params.get(self.ordering_param):
            ordering = [self.relevance_param, *(ordering or [])]

        if not ordering:
            return ordering

        resolved = []
        for term in ordering:
            if term.lstrip("-") != self.relevance_param:
                resolved.append(term)
            elif is_search:
                # `relevance` means best-first, hence the inverted sign.
                descending = not term.startswith("-")
                resolved.append("-search_rank" if descending else "search_rank")

        return resolved or self.get_default_ordering(view)
