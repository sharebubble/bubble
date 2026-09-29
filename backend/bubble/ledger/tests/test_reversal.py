"""Full reversals and partial corrections (plan examples f and h)."""

from decimal import Decimal

import pytest

from bubble.ledger.exceptions import OverReversalError
from bubble.ledger.models import TransactionKind
from bubble.ledger.services import (
    reverse_transaction,
    reversible_amounts,
    verify_ledger,
)
from bubble.ledger.tests.helpers import display_balance


@pytest.fixture
def dinner(members, post):
    """Example g: Alice paid 60 EUR for four; Bob, Carla, Dan owe 15 EUR each."""
    return post(
        (members["bob"], "15"),
        (members["carla"], "15"),
        (members["dan"], "15"),
        (members["alice"], "-45"),
        kind=TransactionKind.SHARED_EXPENSE,
    )


def entry_of(tx, account):
    return tx.entries.get(account=account)


def test_full_reversal_restores_every_balance(members, dinner):
    reversal = reverse_transaction(dinner, created_by=members["alice"])

    assert reversal.kind == TransactionKind.REVERSAL
    assert reversal.reverses == dinner
    assert list(dinner.reversed_by.all()) == [reversal]
    for account in members.values():
        assert display_balance(account) == 0
    assert verify_ledger().ok


def test_example_h_dan_disputes_only_his_share(members, dinner):
    correction = reverse_transaction(
        dinner,
        created_by=members["alice"],
        parts={
            entry_of(dinner, members["dan"]): Decimal("15"),
            entry_of(dinner, members["alice"]): Decimal("-15"),
        },
        description="Dan was not at the dinner",
    )

    assert correction.kind == TransactionKind.CORRECTION
    assert display_balance(members["dan"]) == 0
    assert display_balance(members["alice"]) == Decimal("30.00")
    assert display_balance(members["bob"]) == Decimal("-15.00")
    assert display_balance(members["carla"]) == Decimal("-15.00")
    # The original transaction is untouched.
    assert entry_of(dinner, members["dan"]).amount.amount == Decimal("15.00")


def test_reversal_after_correction_undoes_only_what_is_left(members, dinner):
    reverse_transaction(
        dinner,
        created_by=members["alice"],
        parts={
            entry_of(dinner, members["dan"]): Decimal("15"),
            entry_of(dinner, members["alice"]): Decimal("-15"),
        },
    )
    reversal = reverse_transaction(dinner, created_by=members["alice"])

    assert reversal.entries.count() == 3  # noqa: PLR2004 - Dan's share is already undone
    for account in members.values():
        assert display_balance(account) == 0


def test_cannot_reverse_twice(members, dinner):
    reverse_transaction(dinner, created_by=members["alice"])
    with pytest.raises(OverReversalError, match="nothing left"):
        reverse_transaction(dinner, created_by=members["alice"])


@pytest.mark.parametrize(
    "dan_amount",
    [Decimal("16"), Decimal("-5"), Decimal("0")],
    ids=["more-than-the-share", "wrong-direction", "zero"],
)
def test_correction_cannot_exceed_or_invert_the_original(members, dinner, dan_amount):
    with pytest.raises(OverReversalError):
        reverse_transaction(
            dinner,
            created_by=members["alice"],
            parts={
                entry_of(dinner, members["dan"]): dan_amount,
                entry_of(dinner, members["alice"]): -dan_amount,
            },
        )


def test_correction_must_still_balance(members, dinner):
    from bubble.ledger.exceptions import UnbalancedTransactionError

    with pytest.raises(UnbalancedTransactionError):
        reverse_transaction(
            dinner,
            created_by=members["alice"],
            parts={entry_of(dinner, members["dan"]): Decimal("15")},
        )


def test_correction_rejects_entries_of_other_transactions(members, dinner, post):
    other = post((members["bob"], "5"), ("income:rental", "-5"))
    with pytest.raises(OverReversalError, match="not part of"):
        reverse_transaction(
            dinner,
            created_by=members["alice"],
            parts={
                entry_of(other, members["bob"]): Decimal("5"),
                entry_of(dinner, members["alice"]): Decimal("-5"),
            },
        )


def test_reversible_amounts_reports_what_is_left(members, dinner):
    reverse_transaction(
        dinner,
        created_by=members["alice"],
        parts={
            entry_of(dinner, members["dan"]): Decimal("5"),
            entry_of(dinner, members["alice"]): Decimal("-5"),
        },
    )
    left = {e.account.code: amount for e, amount in reversible_amounts(dinner).items()}

    assert left[members["dan"].code] == Decimal("10.00")
    assert left[members["alice"].code] == Decimal("-40.00")
    assert left[members["bob"].code] == Decimal("15.00")
