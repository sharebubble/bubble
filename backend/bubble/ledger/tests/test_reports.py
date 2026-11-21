"""Statistics, statements and the annual report (plan D7, D12, phase 5)."""

import datetime
from decimal import Decimal

import pytest
from django.contrib.auth.models import Group
from rest_framework import status
from rest_framework.test import APIClient

from bubble.bookings.tests.factories import ItemFactory
from bubble.ledger.intents import LEDGER_ADMIN_GROUP
from bubble.ledger.models import (
    Account,
    AccountType,
    Category,
    Project,
    TransactionKind,
)
from bubble.ledger.reports import account_statement, annual_report, ledger_stats
from bubble.ledger.services import (
    Leg,
    get_system_account,
    post_transaction,
    reverse_transaction,
)
from bubble.ledger.tests.helpers import eur

STATS = "/api/ledger/stats/"
CATEGORIES = "/api/ledger/categories/"
PROJECTS = "/api/ledger/projects/"
JAN = datetime.date(2025, 1, 15)
MAR = datetime.date(2025, 3, 10)
DEC_PREV = datetime.date(2024, 12, 20)
D = Decimal


@pytest.fixture
def cat(book):
    return lambda code: Category.objects.get(book=book, code=code)


@pytest.fixture
def workshop(book):
    return Project.objects.create(
        book=book, name="Workshop", slug="workshop", budget=eur(200)
    )


@pytest.fixture
def year(members, post, cat, workshop):
    """A small year of bookkeeping.

    * Dec 2024: Bob tops up 100 € (before the year).
    * Jan: Alice buys a drill for 50 € (tools, workshop).
    * Jan: Bob rents it for 20 € (rental income).
    * Mar: Alice buys paint for 30 € (consumables, workshop), later reversed.
    """
    alice, bob = members["alice"], members["bob"]
    post(
        ("asset:bank", 100),
        (bob, -100),
        kind=TransactionKind.TOP_UP,
        occurred_on=DEC_PREV,
        category=cat("top-up"),
        created_by=bob,
    )
    drill = post(
        ("expense:tools", 50),
        (alice, -50),
        kind=TransactionKind.MEMBER_EXPENSE,
        occurred_on=JAN,
        category=cat("tools"),
        project=workshop,
        created_by=alice,
        description="Drill",
    )
    post(
        (bob, 20),
        ("income:rental", -20),
        kind=TransactionKind.BOOKING_CHARGE,
        occurred_on=JAN,
        category=cat("rental"),
        description="Rental of the drill",
    )
    paint = post(
        ("expense:consumables", 30),
        (alice, -30),
        kind=TransactionKind.MEMBER_EXPENSE,
        occurred_on=MAR,
        category=cat("consumables"),
        project=workshop,
        created_by=alice,
        description="Paint",
    )
    reversal = reverse_transaction(
        paint, created_by=alice, description="Wrong shop", occurred_on=MAR
    )
    return {"drill": drill, "paint": paint, "reversal": reversal}


def rows_by_code(stats):
    return {row.code: row for row in stats.rows}


class TestStats:
    def test_totals_and_reversals_net_out(self, year):
        stats = ledger_stats(
            "category",
            date_from=datetime.date(2025, 1, 1),
            date_to=datetime.date(2025, 12, 31),
        )
        # Paint was reversed: it neither costs nor counts.
        assert stats.totals.expense == D("50.00")
        assert stats.totals.income == D("20.00")
        assert stats.totals.amount == D("70.00")
        assert stats.totals.count == 3  # noqa: PLR2004
        rows = rows_by_code(stats)
        assert rows["tools"].expense == D("50.00")
        assert rows["rental"].income == D("20.00")
        assert rows["consumables"].expense == D("0.00")
        assert rows["consumables"].amount == D("0.00")
        assert "top-up" not in rows  # before the period

    def test_by_project_with_budget(self, year, workshop):
        stats = ledger_stats("project")
        project = next(r for r in stats.rows if r.key == str(workshop.pk))
        assert project.expense == D("50.00")
        assert project.budget == D("200.00")
        unassigned = next(r for r in stats.rows if r.key is None)
        assert unassigned.amount == D("120.00")  # top-up and rental

    def test_by_month(self, year):
        stats = ledger_stats("month", date_from=datetime.date(2025, 1, 1))
        assert [(r.label, r.expense, r.income) for r in stats.rows] == [
            ("2025-01", D("50.00"), D("20.00")),
            ("2025-03", D("0.00"), D("0.00")),
        ]

    def test_by_member(self, year, members):
        stats = ledger_stats("member")
        rows = {r.label: r for r in stats.rows}
        # Alice: +50 drill, +30 paint, -30 undoing it.
        assert rows["Alice"].credited == D("50.00")
        assert rows["Alice"].charged == D("0.00")
        assert rows["Bob"].credited == D("100.00")
        assert rows["Bob"].charged == D("20.00")
        assert "Carla" not in rows

    def test_by_kind(self, year):
        rows = {r.key: r for r in ledger_stats("kind").rows}
        assert rows["member_expense"].count == 2  # noqa: PLR2004
        assert rows["member_expense"].expense == D("80.00")
        assert rows["reversal"].count == 0
        assert rows["reversal"].expense == D("-30.00")

    def test_by_item_keeps_deleted_items(self, members, book):
        drill, stove = ItemFactory(name="Drill"), ItemFactory(name="Stove")
        for item, price in [(drill, 20), (stove, 15), (drill, 5)]:
            post_transaction(
                book=book,
                kind=TransactionKind.BOOKING_CHARGE,
                occurred_on=JAN,
                description=f"Rental of {item.name}",
                legs=[
                    Leg(members["bob"], eur(price), item=item),
                    Leg(get_system_account("income:rental"), eur(-price), item=item),
                ],
            )
        stove_id = stove.pk
        stove.delete()
        rows = {r.key: r for r in ledger_stats("item").rows}
        assert rows[str(drill.pk)].label == "Drill"
        assert rows[str(drill.pk)].income == D("25.00")
        assert rows[str(drill.pk)].count == 2  # noqa: PLR2004
        assert rows[str(stove_id)].label == "Deleted item"
        assert rows[str(stove_id)].amount == D("15.00")

    def test_filter_by_category_and_project(self, year, cat, workshop):
        assert ledger_stats("month", category=cat("tools")).totals.amount == D("50.00")
        assert ledger_stats("category", project=workshop).totals.count == 2  # noqa: PLR2004

    def test_unknown_grouping(self, db):
        with pytest.raises(ValueError, match="Unknown grouping"):
            ledger_stats("colour")


class TestStatement:
    def test_opening_running_and_closing_balance(self, year, members):
        statement = account_statement(
            members["alice"], datetime.date(2025, 2, 1), datetime.date(2025, 12, 31)
        )
        assert statement.opening_balance == D("50.00")
        assert [(line.amount, line.balance_after) for line in statement.lines] == [
            (D("30.00"), D("80.00")),
            (D("-30.00"), D("50.00")),
        ]
        assert statement.closing_balance == D("50.00")
        assert statement.credited == D("30.00")
        assert statement.charged == D("30.00")

    def test_api_and_csv(self, year, members):
        client = APIClient()
        client.force_authenticate(members["carla"].owner)  # balances are public (D8)
        bob = members["bob"]
        url = f"/api/ledger/accounts/{bob.pk}/statement/"

        response = client.get(url, {"date_from": "2025-01-01", "date_to": "2025-12-31"})

        assert response.status_code == status.HTTP_200_OK, response.data
        assert response.data["opening_balance"] == "100.00"
        assert response.data["closing_balance"] == "80.00"
        assert response.data["lines"][0]["description"] == "Rental of the drill"
        assert response.data["lines"][0]["kind"] == "booking_charge"

        csv = client.get(
            f"{url}csv/", {"date_from": "2025-01-01", "date_to": "2025-12-31"}
        )
        assert csv.status_code == status.HTTP_200_OK
        assert csv["Content-Type"].startswith("text/csv")
        text = csv.content.decode("utf-8-sig")
        assert "Rental of the drill" in text
        assert "-20.00" in text
        assert "80.00" in text

    def test_defaults_to_this_year_and_checks_the_period(self, members):
        client = APIClient()
        client.force_authenticate(members["alice"].owner)
        url = f"/api/ledger/accounts/{members['alice'].pk}/statement/"
        today = datetime.date.today()  # noqa: DTZ011
        assert client.get(url).data["date_from"] == f"{today.year}-01-01"
        bad = client.get(url, {"date_from": "2025-02-01", "date_to": "2025-01-01"})
        assert bad.status_code == status.HTTP_400_BAD_REQUEST


class TestAnnualReport:
    def test_everything_adds_up(self, year, members):
        report = annual_report(2025)

        assert [(r.code, r.income) for r in report.income] == [("rental", D("20.00"))]
        assert [(r.code, r.expense) for r in report.expense] == [("tools", D("50.00"))]
        assert report.result == D("-30.00")
        # Bob paid in 100 € before the year and owes 20 € of it now.
        members_by_name = {p.account.owner.username: p for p in report.members}
        assert members_by_name["bob"].opening == D("100.00")
        assert members_by_name["bob"].closing == D("80.00")
        assert members_by_name["alice"].closing == D("50.00")
        assert report.owed_to_members == D("130.00")
        assert report.owed_by_members == D("0.00")
        bank = next(p for p in report.money if p.account.code == "asset:bank")
        assert (bank.opening, bank.closing) == (D("100.00"), D("100.00"))
        assert report.trial_balance == 0
        assert report.reconciles

    def test_api_and_csv(self, year, members):
        client = APIClient()
        client.force_authenticate(members["carla"].owner)

        response = client.get("/api/ledger/reports/annual/", {"year": 2025})

        assert response.status_code == status.HTTP_200_OK, response.data
        assert response.data["result"] == "-30.00"
        assert response.data["reconciles"] is True
        assert response.data["projects"][0]["label"] == "Workshop"
        csv = client.get("/api/ledger/reports/annual/csv/", {"year": 2025})
        text = csv.content.decode("utf-8-sig")
        assert "Tools and equipment" in text
        assert "Workshop" in text

    def test_login_required(self, db):
        assert APIClient().get("/api/ledger/reports/annual/").status_code in (401, 403)


class TestStatsApi:
    def test_grouping_and_validation(self, year, members):
        client = APIClient()
        client.force_authenticate(members["bob"].owner)

        response = client.get(STATS, {"group_by": "project"})

        assert response.status_code == status.HTTP_200_OK, response.data
        assert response.data["currency"] == "EUR"
        assert response.data["totals"]["expense"] == "50.00"
        workshop = next(r for r in response.data["rows"] if r["label"] == "Workshop")
        assert workshop["budget"] == "200.00"
        assert client.get(STATS, {"group_by": "colour"}).status_code == 400  # noqa: PLR2004
        bad = client.get(STATS, {"date_from": "2025-02-01", "date_to": "2025-01-01"})
        assert bad.status_code == status.HTTP_400_BAD_REQUEST


@pytest.fixture
def treasurer(members):
    group, _ = Group.objects.get_or_create(name=LEDGER_ADMIN_GROUP)
    members["dan"].owner.groups.add(group)
    client = APIClient()
    client.force_authenticate(members["dan"].owner)
    return client


@pytest.fixture
def member_client(members):
    client = APIClient()
    client.force_authenticate(members["bob"].owner)
    return client


class TestManagingCategories:
    def test_members_read_the_treasurer_writes(self, member_client, treasurer):
        denied = member_client.post(
            CATEGORIES, {"name": "Garden", "kind": "expense"}, format="json"
        )
        assert denied.status_code == status.HTTP_403_FORBIDDEN

        response = treasurer.post(
            CATEGORIES, {"name": "Garden supplies", "kind": "expense"}, format="json"
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert response.data["code"] == "garden-supplies"
        assert response.data["has_default_name"] is False
        account = Account.objects.get(pk=response.data["account"])
        assert account.code == "expense:garden-supplies"
        assert account.type == AccountType.EXPENSE
        assert hasattr(account, "balance")
        listed = member_client.get(CATEGORIES, {"kind": "expense"}).data
        assert "Garden supplies" in [c["name"] for c in listed]

    def test_a_new_category_can_be_posted_to(self, members, treasurer):
        pk = treasurer.post(
            CATEGORIES, {"name": "Garden", "kind": "expense"}, format="json"
        ).data["id"]
        client = APIClient()
        client.force_authenticate(members["alice"].owner)
        response = client.post(
            "/api/ledger/transactions/",
            {
                "intent": "expense_for_community",
                "amount": "12.00",
                "occurred_on": "2025-05-01",
                "description": "Seeds",
                "category": pk,
            },
            format="multipart",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.data
        rows = rows_by_code(ledger_stats("category"))
        assert rows["garden"].expense == D("12.00")

    def test_rename_reorder_and_retire(self, treasurer, member_client, cat):
        tools = cat("tools")
        response = treasurer.patch(
            f"{CATEGORIES}{tools.pk}/",
            {"name": "Workshop tools", "sort_order": 1, "is_active": False},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK, response.data
        assert response.data["has_default_name"] is False
        names = [c["name"] for c in member_client.get(CATEGORIES).data]
        assert "Workshop tools" not in names
        # Only the treasurer sees retired categories.
        assert "Workshop tools" in [
            c["name"]
            for c in treasurer.get(CATEGORIES, {"include_hidden": "true"}).data
        ]
        assert "Workshop tools" not in [
            c["name"]
            for c in member_client.get(CATEGORIES, {"include_hidden": "true"}).data
        ]

    def test_what_cannot_change(self, treasurer, cat):
        top_up = cat("top-up")
        assert (
            treasurer.patch(
                f"{CATEGORIES}{top_up.pk}/", {"name": "Money in"}, format="json"
            ).status_code
            == status.HTTP_400_BAD_REQUEST
        )
        kind = treasurer.patch(
            f"{CATEGORIES}{cat('tools').pk}/", {"kind": "income"}, format="json"
        )
        assert kind.status_code == status.HTTP_400_BAD_REQUEST
        transfer = treasurer.post(
            CATEGORIES, {"name": "X", "kind": "transfer"}, format="json"
        )
        assert transfer.status_code == status.HTTP_400_BAD_REQUEST
        assert treasurer.delete(f"{CATEGORIES}{cat('tools').pk}/").status_code == 405  # noqa: PLR2004

    def test_an_existing_account_of_the_same_kind(self, treasurer):
        rental = get_system_account("income:rental")
        wrong = treasurer.post(
            CATEGORIES,
            {"name": "Workshop fees", "kind": "expense", "account": str(rental.pk)},
            format="json",
        )
        assert wrong.status_code == status.HTTP_400_BAD_REQUEST
        right = treasurer.post(
            CATEGORIES,
            {"name": "Workshop fees", "kind": "income", "account": str(rental.pk)},
            format="json",
        )
        assert right.status_code == status.HTTP_201_CREATED
        assert right.data["account"] == rental.pk


class TestManagingProjects:
    def test_create_edit_archive(self, treasurer, member_client):
        assert (
            member_client.post(
                PROJECTS, {"name": "Festival"}, format="json"
            ).status_code
            == status.HTTP_403_FORBIDDEN
        )
        response = treasurer.post(
            PROJECTS,
            {"name": "Summer festival", "budget": "500.00", "starts_on": "2025-06-01"},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert response.data["slug"] == "summer-festival"
        assert response.data["budget"] == "500.00"
        pk = response.data["id"]

        bad = treasurer.patch(
            f"{PROJECTS}{pk}/", {"ends_on": "2025-05-01"}, format="json"
        )
        assert bad.status_code == status.HTTP_400_BAD_REQUEST
        changed = treasurer.patch(
            f"{PROJECTS}{pk}/",
            {"budget": None, "is_archived": True, "name": "Summer fest"},
            format="json",
        )
        assert changed.data["budget"] is None
        assert changed.data["slug"] == "summer-festival"  # links stay valid
        assert member_client.get(PROJECTS).data == []
        assert [
            p["name"] for p in treasurer.get(PROJECTS, {"include_hidden": "true"}).data
        ] == ["Summer fest"]

    def test_slugs_stay_unique(self, treasurer):
        first = treasurer.post(PROJECTS, {"name": "Garden"}, format="json").data
        second = treasurer.post(PROJECTS, {"name": "Garden"}, format="json").data
        assert (first["slug"], second["slug"]) == ("garden", "garden-2")
