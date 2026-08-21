"""Tests for relevance-ranked item search."""

# mypy: ignore-errors

from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from bubble.items.api.search import (
    MAX_SEARCH_TERMS,
    parse_search_query,
    relevance_score,
)
from bubble.items.models import Item, ItemStatus, SalesType, VisibilityType
from bubble.items.tests.factories import ItemOwnerUserFactory

TEST_PASSWORD = "testpass123"  # noqa: S105


class ParseSearchQueryTestCase(TestCase):
    """The query parser: splitting, quoting, de-duplication and the cap."""

    def test_splits_on_whitespace(self):
        query = parse_search_query("  cordless   drill ")
        assert query.phrase == "cordless   drill"
        assert query.terms == ("cordless", "drill")

    def test_quoted_phrase_stays_one_term(self):
        query = parse_search_query('"drill press" cordless')
        assert query.terms == ("drill press", "cordless")

    def test_repeated_terms_are_collapsed(self):
        assert parse_search_query("drill drill").terms == ("drill",)

    def test_term_count_is_capped(self):
        query = parse_search_query(" ".join(f"term{i}" for i in range(20)))
        assert len(query.terms) == MAX_SEARCH_TERMS

    def test_blank_query_is_falsy(self):
        assert not parse_search_query("   ")
        assert not parse_search_query(None)


class RelevanceScoreTestCase(TestCase):
    """The in-memory scorer used to rank merged local + remote results."""

    def test_title_match_outranks_description_match(self):
        query = parse_search_query("ladder")
        title_hit = relevance_score(query, "Ladder", "")
        description_hit = relevance_score(query, "Paint bucket", "Comes with a ladder")
        assert title_hit > description_hit

    def test_exact_title_outranks_partial_title(self):
        query = parse_search_query("ladder")
        assert relevance_score(query, "Ladder", "") > relevance_score(
            query, "Ladder rack for a van", ""
        )

    def test_prefix_outranks_mid_title_match(self):
        query = parse_search_query("ladder")
        assert relevance_score(query, "Ladder rack", "") > relevance_score(
            query, "Wooden ladder", ""
        )

    def test_no_match_scores_zero(self):
        assert relevance_score(parse_search_query("ladder"), "Hammer", "A hammer") == 0


class ItemSearchRankingAPITestCase(TestCase):
    """The public item list ranks title matches above description matches."""

    def setUp(self):
        self.user = ItemOwnerUserFactory(
            username="searchuser", email="search@example.com", password=TEST_PASSWORD
        )
        # Anonymous browsing is gated by the REQUIRE_LOGIN setting, so the
        # ranking is exercised as a logged-in visitor.
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        def make(name, description):
            return Item.objects.create(
                name=name,
                description=description,
                user=self.user,
                sales_type=SalesType.SELL,
                status=ItemStatus.AVAILABLE,
                visibility=VisibilityType.PUBLIC,
                category="tools",
            )

        # Created oldest-first, so the default `-created_at` ordering would
        # return the exact reverse of the expected relevance order.
        self.exact = make("Ladder", "Reaches the roof")
        self.prefix = make("Ladder rack", "Fits on a van")
        self.contains = make("Wooden ladder", "Sturdy")
        self.description_only = make("Paint bucket", "Sold with a ladder")
        # Every item mentions "ladder", so a search for it matches all of them
        # and only the ordering distinguishes the expectations below.
        self.ranked_names = [
            self.exact.name,
            self.prefix.name,
            self.contains.name,
            self.description_only.name,
        ]

    def search(self, query, extra=""):
        url = reverse("api:public-item-list") + f"?search={query}{extra}"
        response = self.client.get(url)
        assert response.status_code == status.HTTP_200_OK
        return [item["name"] for item in response.json()["results"]]

    def test_results_are_ranked_title_first(self):
        assert self.search("ladder") == self.ranked_names

    def test_explicit_ordering_still_wins(self):
        """A client that asks for a specific order keeps getting it."""
        assert self.search("ladder", extra="&ordering=name") == sorted(
            self.ranked_names
        )

    def test_ordering_relevance_can_be_requested_explicitly(self):
        assert self.search("ladder", extra="&ordering=relevance")[0] == self.exact.name

    def test_ordering_relevance_without_a_search_falls_back(self):
        """Nothing to rank by: the request must not error out."""
        url = reverse("api:public-item-list") + "?ordering=relevance"
        response = self.client.get(url)
        assert response.status_code == status.HTTP_200_OK
        names = [item["name"] for item in response.json()["results"]]
        assert sorted(names) == sorted(self.ranked_names)

    def test_all_terms_must_match(self):
        """Multi-word queries match across fields instead of as one phrase."""
        names = self.search("ladder+van")
        assert names == [self.prefix.name]

    def test_quoted_phrase_is_matched_verbatim(self):
        names = self.search('"ladder rack"')
        assert names == [self.prefix.name]

    def test_search_is_case_insensitive(self):
        assert self.search("LADDER")[0] == self.exact.name


class SearchFacetsMatchListTestCase(TestCase):
    """Facet counts are computed with the same matching rules as the list."""

    def setUp(self):
        self.user = ItemOwnerUserFactory(
            username="facetsearch", email="facet@example.com", password=TEST_PASSWORD
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        Item.objects.create(
            name="Ladder rack",
            description="Fits on a van",
            user=self.user,
            sales_type=SalesType.SELL,
            status=ItemStatus.AVAILABLE,
            visibility=VisibilityType.PUBLIC,
            category="tools",
        )
        Item.objects.create(
            name="Paint bucket",
            description="Sold with a ladder",
            user=self.user,
            sales_type=SalesType.SELL,
            status=ItemStatus.AVAILABLE,
            visibility=VisibilityType.PUBLIC,
            category="garden",
        )

    def test_multi_term_query_narrows_facet_counts(self):
        url = reverse("api:public-item-facets") + "?search=ladder+van"
        response = self.client.get(url)
        assert response.status_code == status.HTTP_200_OK
        categories = response.json()["categories"]
        assert categories == [{"category": "tools", "count": 1}]


class FederatedSearchRankingTestCase(TestCase):
    """The unified local + remote search ranks by relevance, not by name.

    Local and remote rows are merged in Python, so this covers the in-memory
    ranking path; only local items are needed to pin the ordering down.
    """

    def setUp(self):
        self.user = ItemOwnerUserFactory(
            username="fedsearch", email="fed@example.com", password=TEST_PASSWORD
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        for name, description in [
            ("Apron", "Protects from a ladder's rust"),
            ("Ladder", "Reaches the roof"),
        ]:
            Item.objects.create(
                name=name,
                description=description,
                user=self.user,
                sales_type=SalesType.SELL,
                status=ItemStatus.AVAILABLE,
                visibility=VisibilityType.PUBLIC,
                category="tools",
            )

    def test_title_match_comes_before_description_match(self):
        url = reverse("api:federated-item-list") + "?search=ladder&scope=local"
        response = self.client.get(url)
        assert response.status_code == status.HTTP_200_OK
        names = [item["name"] for item in response.json()["results"]]
        # Alphabetically "Apron" would come first; relevance puts it last.
        assert names == ["Ladder", "Apron"]
