"""Tests for the ledger's invariants.

These cover the properties the rest of the system trusts: transactions
balance, history is immutable, corrections reverse rather than edit, and a
retried write lands once.
"""

from decimal import Decimal

import pytest
from django.conf import settings
from moneyed import Money

from bubble.bookings.models import BookingStatus
from bubble.ledger.models import Account, Transaction, TransactionKind
from bubble.ledger.services import (
    LedgerError,
    current_booking_payment,
    record_booking_payment,
    record_transaction,
)
from bubble.ledger.tests.factories import (
    CompletedBookingFactory,
    FreeSaleItemFactory,
    PricedItemFactory,
)
from bubble.users.tests.factories import UserFactory


def euros(amount: str) -> Money:
    return Money(Decimal(amount), settings.DEFAULT_CURRENCY)


@pytest.fixture
def booker(db):
    return UserFactory()


@pytest.fixture
def free_booking(booker):
    return CompletedBookingFactory(item=FreeSaleItemFactory(), user=booker)


@pytest.fixture
def priced_booking(booker):
    return CompletedBookingFactory(item=PricedItemFactory(), user=booker)


# ---------------------------------------------------------------------------
# Balance rules
# ---------------------------------------------------------------------------


def test_payment_moves_money_from_booker_to_owner(free_booking, booker):
    record_booking_payment(
        booking=free_booking, amount=euros("12.00"), recorded_by=booker
    )

    payer = Account.objects.for_user(booker)
    payee = Account.objects.for_user(free_booking.item.user)
    assert payer.balance == euros("-12.00")
    assert payee.balance == euros("12.00")


def test_postings_of_a_transaction_sum_to_zero(free_booking, booker):
    payment = record_booking_payment(
        booking=free_booking, amount=euros("7.50"), recorded_by=booker
    )

    total = sum(posting.amount.amount for posting in payment.postings.all())
    assert total == Decimal("0")


def test_unbalanced_transactions_are_refused(db, booker):
    account = Account.objects.for_user(booker)
    other = Account.objects.for_user(UserFactory())

    with pytest.raises(LedgerError):
        record_transaction(
            kind=TransactionKind.BOOKING_PAYMENT,
            entries=[(account, euros("-5.00")), (other, euros("4.00"))],
            idempotency_key="unbalanced",
        )
    assert not Transaction.objects.exists()


def test_a_single_sided_transaction_is_refused(db, booker):
    account = Account.objects.for_user(booker)

    with pytest.raises(LedgerError):
        record_transaction(
            kind=TransactionKind.BOOKING_PAYMENT,
            entries=[(account, euros("5.00"))],
            idempotency_key="one-sided",
        )


# ---------------------------------------------------------------------------
# Idempotency and corrections
# ---------------------------------------------------------------------------


def test_the_same_idempotency_key_posts_once(db, booker):
    account = Account.objects.for_user(booker)
    other = Account.objects.for_user(UserFactory())
    entries = [(account, euros("-5.00")), (other, euros("5.00"))]

    first = record_transaction(
        kind=TransactionKind.BOOKING_PAYMENT, entries=entries, idempotency_key="once"
    )
    second = record_transaction(
        kind=TransactionKind.BOOKING_PAYMENT, entries=entries, idempotency_key="once"
    )

    assert first.pk == second.pk
    assert Transaction.objects.count() == 1
    assert account.balance == euros("-5.00")


def test_recording_again_corrects_rather_than_duplicates(free_booking, booker):
    """A correction reverses the old figure; the balance shows only the new one."""
    record_booking_payment(
        booking=free_booking, amount=euros("5.00"), recorded_by=booker
    )
    record_booking_payment(
        booking=free_booking, amount=euros("8.00"), recorded_by=booker
    )

    payer = Account.objects.for_user(booker)
    assert payer.balance == euros("-8.00")

    standing = current_booking_payment(free_booking)
    assert standing is not None
    credit = max(p.amount for p in standing.postings.all())
    assert credit == euros("8.00")


def test_a_correction_leaves_the_original_in_history(free_booking, booker):
    """History is append-only: the first figure and its reversal both survive."""
    # The original payment, its reversal, and the corrected payment.
    expected_transactions = 3

    record_booking_payment(
        booking=free_booking, amount=euros("5.00"), recorded_by=booker
    )
    record_booking_payment(
        booking=free_booking, amount=euros("8.00"), recorded_by=booker
    )

    assert free_booking.ledger_transactions.count() == expected_transactions
    assert (
        free_booking.ledger_transactions.filter(kind=TransactionKind.REVERSAL).count()
        == 1
    )


# ---------------------------------------------------------------------------
# What may be paid for
# ---------------------------------------------------------------------------


def test_a_booking_that_has_not_completed_cannot_be_paid(booker):
    booking = CompletedBookingFactory(
        item=FreeSaleItemFactory(), user=booker, status=BookingStatus.CONFIRMED
    )

    with pytest.raises(LedgerError):
        record_booking_payment(
            booking=booking, amount=euros("5.00"), recorded_by=booker
        )


def test_a_priced_booking_can_be_settled(priced_booking, booker):
    payment = record_booking_payment(
        booking=priced_booking, amount=euros("20.00"), recorded_by=booker
    )

    assert payment.voluntary is False


def test_zero_and_negative_payments_are_refused(free_booking, booker):
    for amount in ("0.00", "-1.00"):
        with pytest.raises(LedgerError):
            record_booking_payment(
                booking=free_booking, amount=euros(amount), recorded_by=booker
            )


def test_paying_for_your_own_item_is_refused(booker):
    """Both legs would be the same account, so nothing would actually move."""
    item = FreeSaleItemFactory(user=booker)
    booking = CompletedBookingFactory(item=item, user=booker)

    with pytest.raises(LedgerError):
        record_booking_payment(
            booking=booking, amount=euros("5.00"), recorded_by=booker
        )
