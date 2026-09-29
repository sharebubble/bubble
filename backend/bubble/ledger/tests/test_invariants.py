"""Invariants I1-I4 are enforced by the database, not only by Python.

These tests bypass the service layer on purpose: they write rows directly or
run raw SQL, and expect Postgres to refuse.
"""

import ast
import pathlib

import pytest
from django.db import DatabaseError, connection
from django.db import transaction as db_transaction
from moneyed import Money

from bubble.ledger.exceptions import ImmutableLedgerError
from bubble.ledger.models import Entry, Transaction, TransactionKind
from bubble.ledger.services import BALANCE_CONSTRAINTS, get_system_account
from bubble.ledger.tests.helpers import TODAY, eur


def write_raw(book, legs):
    """Insert a transaction and its entries without going through the service."""
    tx = Transaction.objects.create(
        book=book,
        kind=TransactionKind.ADJUSTMENT,
        occurred_on=TODAY,
        description="raw",
    )
    Entry.objects.bulk_create(
        [
            Entry(transaction=tx, account=account, amount=amount)
            for account, amount in legs
        ]
    )
    return tx


def check_now():
    with connection.cursor() as cursor:
        cursor.execute(f"SET CONSTRAINTS {BALANCE_CONSTRAINTS} IMMEDIATE")


class TestBalanceTrigger:
    """I1-I3, checked with SET CONSTRAINTS ... IMMEDIATE inside the test transaction."""

    def run(self, book, legs):
        def write_and_check():
            with db_transaction.atomic():
                write_raw(book, legs)
                check_now()

        with pytest.raises(DatabaseError) as excinfo:
            write_and_check()
        return str(excinfo.value)

    def test_unbalanced(self, book, members):
        message = self.run(
            book,
            [
                (members["bob"], eur("10")),
                (get_system_account("income:rental"), eur("-9")),
            ],
        )
        assert "unbalanced" in message

    def test_single_leg(self, book, members):
        assert "at least 2" in self.run(book, [(members["bob"], eur("10"))])

    def test_no_legs(self, book):
        assert "at least 2" in self.run(book, [])

    def test_zero_leg(self, book, members):
        message = self.run(
            book,
            [
                (members["bob"], eur("10")),
                (get_system_account("income:rental"), eur("-10")),
                (get_system_account("asset:cash"), eur("0")),
            ],
        )
        assert "zero-amount" in message

    def test_foreign_currency(self, book, members):
        message = self.run(
            book,
            [
                (members["bob"], Money("10", "USD")),
                (get_system_account("income:rental"), Money("-10", "USD")),
            ],
        )
        assert "currency" in message

    def test_balanced_raw_write_is_accepted(self, book, members):
        with db_transaction.atomic():
            write_raw(
                book,
                [
                    (members["bob"], eur("10")),
                    (get_system_account("income:rental"), eur("-10")),
                ],
            )
            check_now()


@pytest.mark.django_db(transaction=True)
def test_unbalanced_write_is_refused_at_commit():
    """The trigger fires at COMMIT without any SET CONSTRAINTS.

    Needs a real commit, which the default rolled-back test transaction never
    does; hence transaction=True.
    """
    from bubble.ledger.models import Book

    book = Book.objects.default()
    bank = get_system_account("asset:bank")
    rental = get_system_account("income:rental")

    with pytest.raises(DatabaseError, match="unbalanced"), db_transaction.atomic():
        write_raw(book, [(bank, eur("10")), (rental, eur("-3"))])
    assert not Transaction.objects.exists()


class TestAppendOnly:
    """I4: posted rows can never be changed or deleted."""

    @pytest.fixture
    def tx(self, members, post):
        return post((members["bob"], "10"), ("income:rental", "-10"))

    def test_orm_save_refused(self, tx):
        tx.description = "rewritten history"
        with pytest.raises(ImmutableLedgerError):
            tx.save()

    def test_orm_delete_refused(self, tx):
        with pytest.raises(ImmutableLedgerError):
            tx.delete()
        with pytest.raises(ImmutableLedgerError):
            tx.entries.first().delete()

    def test_queryset_update_and_delete_refused(self, tx):
        with pytest.raises(ImmutableLedgerError):
            Transaction.objects.filter(pk=tx.pk).update(description="x")
        with pytest.raises(ImmutableLedgerError):
            Entry.objects.filter(transaction=tx).delete()

    @pytest.mark.parametrize(
        "sql",
        [
            "UPDATE ledger_transaction SET description = 'x' WHERE id = %s",
            "DELETE FROM ledger_transaction WHERE id = %s",
            "UPDATE ledger_entry SET amount = amount * 2 WHERE transaction_id = %s",
            "DELETE FROM ledger_entry WHERE transaction_id = %s",
        ],
    )
    def test_raw_sql_refused_by_trigger(self, tx, sql):
        with (
            pytest.raises(DatabaseError, match="append-only"),
            db_transaction.atomic(),
            connection.cursor() as cursor,
        ):
            cursor.execute(sql, [tx.pk])


LEDGER_ROWS = {"Entry", "Transaction"}
WRITE_METHODS = {"create", "bulk_create", "get_or_create", "update_or_create"}


def test_only_the_service_layer_writes_ledger_rows():
    """Architecture rule: nothing outside services.py constructs ledger rows."""
    backend = pathlib.Path(__file__).resolve().parents[3]
    allowed = backend / "bubble" / "ledger" / "services.py"
    offenders = []
    for path in (backend / "bubble").rglob("*.py"):
        if path == allowed or {"tests", "migrations"} & set(path.parts):
            continue
        for node in ast.walk(ast.parse(path.read_text())):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            constructs = isinstance(func, ast.Name) and func.id in LEDGER_ROWS
            writes = (
                isinstance(func, ast.Attribute)
                and func.attr in WRITE_METHODS
                and ast.unparse(func.value) in {f"{m}.objects" for m in LEDGER_ROWS}
            )
            if constructs or writes:
                offenders.append(f"{path.relative_to(backend)}:{node.lineno}")
    assert offenders == []
