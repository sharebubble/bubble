"""post_transaction(): the plan's worked examples, and every refusal."""

import datetime
from decimal import Decimal

import pytest
from moneyed import Money

from bubble.ledger.exceptions import (
    ClosedPeriodError,
    CurrencyMismatchError,
    UnbalancedTransactionError,
)
from bubble.ledger.models import (
    Account,
    AccountType,
    Book,
    LedgerPeriod,
    Transaction,
    TransactionKind,
)
from bubble.ledger.rounding import allocate
from bubble.ledger.services import (
    Leg,
    get_system_account,
    post_transaction,
    verify_ledger,
)
from bubble.ledger.tests.helpers import TODAY, display_balance, eur


class TestWorkedExamples:
    """Section 3 of docs/ledger/plan.md, posted for real."""

    def test_a_member_buys_a_drill_for_the_community(self, members, post):
        post(("expense:tools", "50"), (members["alice"], "-50"))

        assert display_balance(members["alice"]) == Decimal("50.00")
        assert display_balance(get_system_account("expense:tools")) == Decimal("50.00")

    def test_b_member_rents_a_community_item(self, members, post):
        post((members["bob"], "10"), ("income:rental", "-10"))

        assert display_balance(members["bob"]) == Decimal("-10.00")
        assert display_balance(get_system_account("income:rental")) == Decimal("10.00")

    def test_c_member_rents_from_another_member(self, members, post):
        post((members["bob"], "20"), (members["carla"], "-20"))

        assert display_balance(members["bob"]) == Decimal("-20.00")
        assert display_balance(members["carla"]) == Decimal("20.00")

    def test_d_top_up_and_e_payout(self, members, post):
        post(("asset:bank", "30"), (members["bob"], "-30"), kind=TransactionKind.TOP_UP)
        post((members["bob"], "30"), ("asset:bank", "-30"), kind=TransactionKind.PAYOUT)

        assert display_balance(members["bob"]) == Decimal("0.00")
        assert display_balance(get_system_account("asset:bank")) == Decimal("0.00")

    def test_g_shared_dinner_split_with_the_rounding_helper(self, members, post):
        shares = allocate(Decimal("60.00"), [1, 1, 1, 1])  # alice, bob, carla, dan
        alices_share, *others = shares
        post(
            (members["bob"], others[0]),
            (members["carla"], others[1]),
            (members["dan"], others[2]),
            (members["alice"], -(sum(others))),
            kind=TransactionKind.SHARED_EXPENSE,
        )

        assert alices_share == Decimal("15.00")
        assert display_balance(members["alice"]) == Decimal("45.00")
        for name in ["bob", "carla", "dan"]:
            assert display_balance(members[name]) == Decimal("-15.00")

    def test_community_accounts_are_untouched_by_member_to_member(self, members, post):
        post((members["bob"], "20"), (members["carla"], "-20"))

        assert verify_ledger().ok
        assert display_balance(get_system_account("asset:bank")) == 0


class TestRefusals:
    def test_unbalanced_legs(self, members, post):
        with pytest.raises(UnbalancedTransactionError, match="sum to"):
            post((members["bob"], "10"), ("income:rental", "-9.99"))
        assert not Transaction.objects.exists()

    def test_single_leg(self, members, post):
        with pytest.raises(UnbalancedTransactionError, match="at least two"):
            post((members["bob"], "0"))

    def test_zero_leg(self, members, post):
        with pytest.raises(UnbalancedTransactionError, match="Zero-amount"):
            post((members["bob"], "10"), ("income:rental", "-10"), ("asset:cash", "0"))

    def test_foreign_currency(self, members):
        with pytest.raises(CurrencyMismatchError):
            post_transaction(
                kind=TransactionKind.ADJUSTMENT,
                occurred_on=TODAY,
                description="wrong currency",
                legs=[
                    Leg(members["bob"], Money("10", "USD")),
                    Leg(get_system_account("income:rental"), Money("-10", "USD")),
                ],
            )

    def test_sub_cent_amounts(self, members, post):
        with pytest.raises(UnbalancedTransactionError, match="whole cents"):
            post((members["bob"], "10.005"), ("income:rental", "-10.005"))

    def test_account_from_another_book(self, members, post):
        other_book = Book.objects.create(slug="other", name="Other")
        stranger = Account.objects.create(
            book=other_book, type=AccountType.ASSET, code="asset:bank", name="Bank"
        )
        with pytest.raises(UnbalancedTransactionError, match="another book"):
            post((members["bob"], "10"), (stranger, "-10"))

    def test_closed_period(self, book, members, post):
        LedgerPeriod.objects.create(
            book=book,
            starts_on=datetime.date(2026, 1, 1),
            ends_on=datetime.date(2026, 6, 30),
            closed_at=datetime.datetime(2026, 7, 5, tzinfo=datetime.UTC),
        )
        with pytest.raises(ClosedPeriodError):
            post(
                (members["bob"], "10"),
                ("income:rental", "-10"),
                occurred_on=datetime.date(2026, 3, 1),
            )
        # The day after the closed period is fine.
        post(
            (members["bob"], "10"),
            ("income:rental", "-10"),
            occurred_on=datetime.date(2026, 7, 1),
        )


class TestBookkeeping:
    def test_idempotency_key_posts_once(self, members, post):
        first = post(
            (members["bob"], "10"),
            ("income:rental", "-10"),
            idempotency_key="booking:1",
        )
        second = post(
            (members["bob"], "10"),
            ("income:rental", "-10"),
            idempotency_key="booking:1",
        )

        assert first == second
        assert Transaction.objects.count() == 1
        assert display_balance(members["bob"]) == Decimal("-10.00")

    def test_cached_balance_tracks_count_and_sequence(self, members, post):
        post((members["bob"], "10"), ("income:rental", "-10"))
        tx = post((members["bob"], "5"), ("income:rental", "-5"))

        balance = members["bob"].balance
        balance.refresh_from_db()
        assert balance.entry_count == 2  # noqa: PLR2004
        assert balance.last_seq == tx.seq

    def test_sequence_is_strictly_increasing(self, members, post):
        seqs = [
            post((members["bob"], "1"), ("income:rental", "-1")).seq for _ in range(5)
        ]
        assert seqs == sorted(seqs)
        assert len(set(seqs)) == len(seqs)

    def test_repeated_account_legs_are_summed_into_the_cache(self, members, post):
        post(
            (members["bob"], "10"),
            (members["bob"], "5"),
            ("income:rental", "-15"),
        )
        assert display_balance(members["bob"]) == Decimal("-15.00")
        assert verify_ledger().ok

    def test_plain_decimals_are_accepted_as_book_currency(self, members):
        tx = post_transaction(
            kind=TransactionKind.ADJUSTMENT,
            occurred_on=TODAY,
            description="decimals",
            legs=[
                Leg(members["bob"], Decimal("2.50")),
                Leg(get_system_account("income:rental"), Decimal("-2.50")),
            ],
        )
        assert {str(e.amount.currency) for e in tx.entries.all()} == {"EUR"}
        assert eur("2.50") in [e.amount for e in tx.entries.all()]
