"""The only supported way to write to the ledger.

Everything goes through :func:`record_transaction`, which is what guarantees
the invariant the rest of the system relies on: a transaction's postings sum
to zero, written in one atomic block. Models are deliberately not written
directly anywhere else.
"""

from decimal import Decimal

from django.db import transaction as db_transaction
from django.utils.translation import gettext_lazy as _
from moneyed import Money

from bubble.bookings.models import Booking, BookingStatus
from bubble.items.models import SalesType
from bubble.ledger.models import Account, Posting, Transaction, TransactionKind


class LedgerError(Exception):
    """A write that would leave the ledger inconsistent."""


# Listing types where something actually changes hands. "Wanted" listings are
# requests rather than offers, so no payment can settle against them.
PAYABLE_SALES_TYPES = (
    SalesType.SELL,
    SalesType.RENT,
    SalesType.DONATE,
    SalesType.BORROW,
)


def is_free_booking(booking: Booking) -> bool:
    """Whether the booked item carries no price (blank or exactly zero)."""
    price = booking.item.price
    return price is None or price.amount == 0


def is_payable_booking(booking: Booking) -> bool:
    """Whether a payment may be recorded against *booking*.

    Only once the booking has **completed**: before that the exchange is
    still in flight, and for a free item there is nothing to value yet. The
    booker must be a local user — a remote federated actor has no account
    here to post against.
    """
    return (
        booking.user_id is not None
        and booking.status == BookingStatus.COMPLETED
        and booking.item.sales_type in PAYABLE_SALES_TYPES
    )


def suggested_amount(booking: Booking) -> Money | None:
    """What to pre-fill the payment form with.

    For a priced booking that is the amount already agreed — a counter-offer
    if one was accepted, else the offer, else the computed rental total or
    the listed price. Free bookings have nothing to suggest from the booking
    itself; the caller falls back to what this member paid last time.
    """
    if is_free_booking(booking):
        return None
    for candidate in (booking.counter_offer, booking.offer, booking.rental_price):
        if candidate is not None:
            return candidate
    return booking.item.price


@db_transaction.atomic
def record_transaction(  # noqa: PLR0913 — keyword-only fields of one ledger write
    *,
    kind: str,
    entries: list[tuple[Account, Money]],
    idempotency_key: str,
    recorded_by=None,
    booking: Booking | None = None,
    description: str = "",
    voluntary: bool = False,
    reverses: Transaction | None = None,
) -> Transaction:
    """Write one balanced transaction, or return the existing one.

    ``entries`` pairs each account with its signed amount. They must sum to
    zero and share a currency. Re-calling with an ``idempotency_key`` that
    has already been used returns the original transaction untouched, so a
    retry or a double-submitted form cannot post twice.
    """
    if len(entries) < 2:  # noqa: PLR2004
        msg = "A transaction needs at least two postings."
        raise LedgerError(msg)

    currencies = {amount.currency for _account, amount in entries}
    if len(currencies) > 1:
        msg = "All postings of a transaction must share one currency."
        raise LedgerError(msg)

    total = sum((amount.amount for _account, amount in entries), Decimal("0"))
    if total != 0:
        msg = f"Postings must sum to zero, got {total}."
        raise LedgerError(msg)

    existing = Transaction.objects.filter(idempotency_key=idempotency_key).first()
    if existing is not None:
        return existing

    ledger_transaction = Transaction.objects.create(
        kind=kind,
        booking=booking,
        description=description,
        recorded_by=recorded_by,
        voluntary=voluntary,
        idempotency_key=idempotency_key,
        reverses=reverses,
    )
    Posting.objects.bulk_create(
        [
            Posting(transaction=ledger_transaction, account=account, amount=amount)
            for account, amount in entries
        ]
    )
    return ledger_transaction


def booking_payment_key(booking: Booking, sequence: int) -> str:
    """Idempotency key for the *n*-th payment recorded on a booking."""
    return f"booking:{booking.pk}:payment:{sequence}"


@db_transaction.atomic
def record_booking_payment(
    *,
    booking: Booking,
    amount: Money,
    recorded_by,
    voluntary: bool = False,
) -> Transaction:
    """Record that the booker paid the item's owner for this booking.

    Money moves from the booker to the owner. Recording a second payment on a
    booking first reverses the previous one, so the booking's net paid amount
    is always the latest figure while the correction stays visible in history.
    """
    if amount.amount <= 0:
        msg = _("A payment must be greater than zero.")
        raise LedgerError(msg)
    if not is_payable_booking(booking):
        msg = _("This booking cannot be paid for yet.")
        raise LedgerError(msg)

    payer = Account.objects.for_user(booking.user)
    payee = Account.objects.for_user(booking.item.user)
    if payer == payee:
        msg = _("A booking on your own item cannot be paid for.")
        raise LedgerError(msg)

    previous = current_booking_payment(booking)
    sequence = booking.ledger_transactions.count()

    if previous is not None:
        reverse_transaction(
            previous,
            recorded_by=recorded_by,
            idempotency_key=f"{previous.idempotency_key}:reversal",
        )
        sequence = booking.ledger_transactions.count()

    return record_transaction(
        kind=TransactionKind.BOOKING_PAYMENT,
        entries=[(payer, -amount), (payee, amount)],
        idempotency_key=booking_payment_key(booking, sequence),
        recorded_by=recorded_by,
        booking=booking,
        description=booking.item.name,
        voluntary=voluntary,
    )


@db_transaction.atomic
def reverse_transaction(
    original: Transaction, *, recorded_by, idempotency_key: str
) -> Transaction:
    """Cancel a transaction out with an equal and opposite one."""
    entries = [
        (posting.account, -posting.amount) for posting in original.postings.all()
    ]
    return record_transaction(
        kind=TransactionKind.REVERSAL,
        entries=entries,
        idempotency_key=idempotency_key,
        recorded_by=recorded_by,
        booking=original.booking,
        description=original.description,
        voluntary=original.voluntary,
        reverses=original,
    )


def current_booking_payment(booking: Booking) -> Transaction | None:
    """The payment currently standing for a booking, if any.

    Reversed payments and the reversals themselves drop out, leaving at most
    the one figure that still counts.
    """
    return (
        booking.ledger_transactions.filter(
            kind=TransactionKind.BOOKING_PAYMENT,
            reversed_by__isnull=True,
        )
        .order_by("-created_at")
        .first()
    )
