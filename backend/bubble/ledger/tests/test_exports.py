"""Period close, journal and DATEV exports (plan section 13, D12, phase 6)."""

import datetime
import hashlib
from decimal import Decimal

import pytest
from constance.test import override_config
from django.contrib.auth.models import Group
from rest_framework import status
from rest_framework.test import APIClient

from bubble.ledger.exceptions import ClosedPeriodError
from bubble.ledger.exports import (
    DatevMappingError,
    close_period,
    datev_bookings,
    datev_csv,
    journal_csv,
)
from bubble.ledger.intents import LEDGER_ADMIN_GROUP
from bubble.ledger.models import Account, Category, TransactionKind
from bubble.ledger.services import get_system_account

JAN = datetime.date(2025, 1, 15)
FEB = datetime.date(2025, 2, 10)
Q1 = (datetime.date(2025, 1, 1), datetime.date(2025, 3, 31))


@pytest.fixture
def books(members, post, book):
    """Q1 2025: Alice buys a drill; a dinner split among three."""
    alice, bob, carla = members["alice"], members["bob"], members["carla"]
    drill = post(
        ("expense:tools", 50),
        (alice, -50),
        kind=TransactionKind.MEMBER_EXPENSE,
        occurred_on=JAN,
        description="Drill",
        category=Category.objects.get(book=book, code="tools"),
    )
    dinner = post(
        (bob, 15),
        (carla, 15),
        (alice, -30),
        kind=TransactionKind.SHARED_EXPENSE,
        occurred_on=FEB,
        description="Dinner",
    )
    return {"drill": drill, "dinner": dinner}


def map_accounts(numbers):
    for code, number in numbers.items():
        Account.objects.filter(code=code).update(datev_number=number)


@pytest.fixture
def treasurer(members):
    group, _ = Group.objects.get_or_create(name=LEDGER_ADMIN_GROUP)
    members["dan"].owner.groups.add(group)
    client = APIClient()
    client.force_authenticate(members["dan"].owner)
    return client


@pytest.fixture
def member(members):
    client = APIClient()
    client.force_authenticate(members["bob"].owner)
    return client


class TestJournal:
    def test_one_row_per_entry_and_the_same_bytes_every_time(self, book, books):
        content = journal_csv(book, *Q1)
        rows = content.decode().splitlines()
        assert rows[0].startswith("date,seq,transaction,kind")
        assert len(rows) == 1 + 2 + 3
        assert "2025-01-15" in rows[1]
        assert ",tools," in rows[1]
        assert content == journal_csv(book, *Q1)

    def test_other_periods_are_left_out(self, book, books):
        rows = journal_csv(book, JAN, JAN).decode().splitlines()
        assert len(rows) == 1 + 2


class TestDatev:
    def test_unmapped_accounts_are_named(self, book, books):
        with pytest.raises(DatevMappingError) as error:
            datev_bookings(book, *Q1)
        codes = {a.code for a in error.value.accounts}
        assert "expense:tools" in codes

    @override_config(DATEV_MEMBER_ACCOUNT="1590")
    def test_bookings_are_two_sided_against_the_largest_leg(self, book, books):
        map_accounts({"expense:tools": "4930"})

        bookings = datev_bookings(book, *Q1)

        drill, bob, carla = bookings
        # Debit the expense, credit Alice (the shared member account).
        assert (drill.account, drill.counter, drill.amount, drill.debit) == (
            "4930",
            "1590",
            Decimal("50.00"),
            True,
        )
        # The dinner: Bob and Carla against Alice's 30 € credit.
        assert {(b.amount, b.debit) for b in (bob, carla)} == {(Decimal("15.00"), True)}
        assert bob.reference == str(books["dinner"].seq)

    @override_config(
        DATEV_MEMBER_ACCOUNT="1590",
        DATEV_CONSULTANT_NUMBER="1001",
        DATEV_CLIENT_NUMBER="42",
    )
    def test_the_file(self, book, books):
        map_accounts({"expense:tools": "4930"})

        content = datev_csv(book, *Q1).decode("cp1252")

        header, columns, *lines = content.split("\r\n")[:-1]
        assert header.startswith('"EXTF";700;21;"Buchungsstapel";13;')
        assert ";1001;42;20250101;4;20250101;20250331;" in header
        assert columns.startswith('"Umsatz (ohne Soll/Haben-Kz)"')
        assert lines[0].startswith('50,00;"S";"EUR";;;"";4930;1590;"";1501;')
        assert len(lines) == 3  # noqa: PLR2004

    def test_a_member_account_can_have_its_own_number(self, book, books, members):
        map_accounts({"expense:tools": "4930"})
        for name in ["alice", "bob", "carla"]:
            Account.objects.filter(pk=members[name].pk).update(datev_number="10001")
        assert datev_bookings(book, *Q1)[0].counter == "10001"


class TestClosing:
    def test_closing_records_the_export_and_the_chain_head(self, book, books, members):
        period = close_period(book, *Q1, user=members["dan"].owner)

        assert period.closed_at is not None
        assert period.transaction_count == 2  # noqa: PLR2004
        assert period.export_hash == hashlib.sha256(journal_csv(book, *Q1)).hexdigest()
        assert period.chain_position == 2  # noqa: PLR2004
        assert period.chain_head == books["dinner"].seal.hash

    def test_nothing_can_be_posted_into_it_afterwards(self, book, books, post, members):
        close_period(book, *Q1, user=members["dan"].owner)
        with pytest.raises(ClosedPeriodError):
            post((members["bob"], 5), ("asset:bank", -5), occurred_on=FEB)
        # Later dates still work.
        post(
            (members["bob"], 5),
            ("asset:bank", -5),
            occurred_on=datetime.date(2025, 4, 1),
        )

    def test_members_get_a_clear_message(self, books, members, treasurer):
        treasurer.post(
            "/api/ledger/periods/",
            {"starts_on": "2025-01-01", "ends_on": "2025-03-31"},
            format="json",
        )
        client = APIClient()
        client.force_authenticate(members["alice"].owner)
        response = client.post(
            "/api/ledger/transactions/",
            {
                "intent": "top_up",
                "amount": "10.00",
                "occurred_on": "2025-02-01",
                "description": "Late",
                "via": "bank",
            },
            format="multipart",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "occurred_on" in response.data

    @pytest.mark.parametrize(
        ("dates", "field"),
        [
            (("2025-03-31", "2025-01-01"), "ends_on"),
            (("2025-01-01", "2999-12-31"), "ends_on"),
        ],
        ids=["reversed", "not-over-yet"],
    )
    def test_invalid_periods(self, books, treasurer, dates, field):
        response = treasurer.post(
            "/api/ledger/periods/",
            {"starts_on": dates[0], "ends_on": dates[1]},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert field in response.data

    def test_no_overlaps(self, books, treasurer):
        treasurer.post(
            "/api/ledger/periods/",
            {"starts_on": "2025-01-01", "ends_on": "2025-03-31"},
            format="json",
        )
        again = treasurer.post(
            "/api/ledger/periods/",
            {"starts_on": "2025-03-01", "ends_on": "2025-04-30"},
            format="json",
        )
        assert again.status_code == status.HTTP_400_BAD_REQUEST

    def test_open_splits_block_closing(self, books, members, treasurer):
        client = APIClient()
        client.force_authenticate(members["alice"].owner)
        client.post(
            "/api/ledger/splits/",
            {
                "description": "Picnic",
                "total": "20.00",
                "occurred_on": "2025-03-01",
                "participants": [{"account": str(members["bob"].pk)}],
            },
            format="json",
        )
        response = treasurer.post(
            "/api/ledger/periods/",
            {"starts_on": "2025-01-01", "ends_on": "2025-03-31"},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST


class TestApi:
    def test_everyone_reads_the_treasurer_closes(self, books, member, treasurer):
        denied = member.post(
            "/api/ledger/periods/",
            {"starts_on": "2025-01-01", "ends_on": "2025-03-31"},
            format="json",
        )
        assert denied.status_code == status.HTTP_403_FORBIDDEN
        created = treasurer.post(
            "/api/ledger/periods/",
            {"starts_on": "2025-01-01", "ends_on": "2025-03-31"},
            format="json",
        )
        assert created.status_code == status.HTTP_201_CREATED, created.data
        listed = member.get("/api/ledger/periods/").data
        assert [p["export_hash"] for p in listed] == [created.data["export_hash"]]
        assert listed[0]["closed_by_name"] == "Dan"

    def test_journal_download_matches_the_recorded_hash(self, books, member, treasurer):
        period = treasurer.post(
            "/api/ledger/periods/",
            {"starts_on": "2025-01-01", "ends_on": "2025-03-31"},
            format="json",
        ).data
        response = member.get(
            "/api/ledger/exports/journal/",
            {"date_from": "2025-01-01", "date_to": "2025-03-31"},
        )
        assert response.status_code == status.HTTP_200_OK
        assert hashlib.sha256(response.content).hexdigest() == period["export_hash"]

    @override_config(DATEV_MEMBER_ACCOUNT="1590")
    def test_datev_is_for_the_treasurer_and_needs_a_mapping(
        self, books, member, treasurer
    ):
        query = {"date_from": "2025-01-01", "date_to": "2025-03-31"}
        assert (
            member.get("/api/ledger/exports/datev/", query).status_code
            == status.HTTP_403_FORBIDDEN
        )
        unmapped = treasurer.get("/api/ledger/exports/datev/", query)
        assert unmapped.status_code == status.HTTP_400_BAD_REQUEST
        assert "expense:tools" in str(unmapped.data)

        tools = get_system_account("expense:tools")
        mapped = treasurer.post(
            f"/api/ledger/accounts/{tools.pk}/datev/",
            {"datev_number": "4930"},
            format="json",
        )
        assert mapped.status_code == status.HTTP_200_OK
        assert mapped.data["datev_number"] == "4930"
        response = treasurer.get("/api/ledger/exports/datev/", query)
        assert response.status_code == status.HTTP_200_OK
        assert response.content.startswith(b'"EXTF";700')

    def test_datev_numbers_are_digits_and_treasurer_only(
        self, books, member, treasurer
    ):
        tools = get_system_account("expense:tools")
        url = f"/api/ledger/accounts/{tools.pk}/datev/"
        assert (
            member.post(url, {"datev_number": "4930"}, format="json").status_code
            == status.HTTP_403_FORBIDDEN
        )
        bad = treasurer.post(url, {"datev_number": "49a0"}, format="json")
        assert bad.status_code == status.HTTP_400_BAD_REQUEST
