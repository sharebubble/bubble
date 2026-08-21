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
from finding "Chainsaw". ``docs/search.md`` records that trade-off along with
the follow-ups it leaves open (``pg_trgm`` typo tolerance, ``unaccent``).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from django.db.models import Case, IntegerField, Q, QuerySet, Value, When
from rest_framework import filters

# Matching/ranking is capped so a pathological query ("a b c d e …") cannot
# turn into an unbounded number of ILIKE comparisons per row.
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


def search_filter_q(
    query: SearchQuery,
    *,
    extra_fields: tuple[str, ...] = (),
) -> Q:
    """Return the ``Q`` matching every term in name, description or extras.

    Terms are ANDed and fields are ORed: an item matches when each term is
    found somewhere, not necessarily all in the same field.
    """
    fields = ("name", "description", *extra_fields)

    combined = Q()
    for term in query.terms:
        term_q = Q()
        for field in fields:
            term_q |= Q(**{f"{field}__icontains": term})
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
        _when(Q(name__iexact=phrase), WEIGHT_NAME_EXACT)
        + _when(Q(name__istartswith=phrase), WEIGHT_NAME_PREFIX)
        + _when(Q(name__icontains=phrase), WEIGHT_NAME_PHRASE)
        + _when(Q(description__icontains=phrase), WEIGHT_DESCRIPTION_PHRASE)
    )

    # Per-term credit, so a two-of-three-terms title still outranks a
    # description that happens to contain the full phrase's words.
    for term in query.terms:
        expression = (
            expression
            + _when(Q(name__icontains=term), WEIGHT_NAME_TERM)
            + _when(Q(description__icontains=term), WEIGHT_DESCRIPTION_TERM)
        )
        for field in extra_fields:
            expression = expression + _when(
                Q(**{f"{field}__icontains": term}), WEIGHT_EXTRA_TERM
            )

    return expression


def relevance_score(query: SearchQuery, name: str, description: str) -> int:
    """Score an in-memory row as :func:`relevance_annotation` scores a database row.

    There is no ``extra_fields`` counterpart here: the only in-memory caller is
    the federated list, and remote items carry no metadata beyond title and
    description.
    """
    name = (name or "").lower()
    description = (description or "").lower()
    phrase = query.phrase.lower()

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
        lowered = term.lower()
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
