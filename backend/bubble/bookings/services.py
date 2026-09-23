"""Booking steps that move ownership or money (ledger plan section 6, D14-D18).

Rentals are charged when they complete. Sales are agreed when the seller accepts
the amount: the terms are frozen on the booking and the item moves to the buyer
as a draft (D17). The buyer then approves the hand-over, which charges the frozen
amount, or rejects it, which cancels the sale free of charge and gives the item
back to the seller (D18). The seller cannot cancel an accepted sale.

Every function here runs inside the caller's transaction (requests are atomic),
so a booking never changes state without its ledger posting, or the reverse.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import timedelta
from typing import TYPE_CHECKING

from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from bubble.bookings.models import (
    Booking,
    BookingLedgerState,
    BookingStatus,
    Message,
)
from bubble.items.models import LedgerBeneficiary, SalesType
from bubble.ledger.models import Book, Category, Transaction, TransactionKind
from bubble.ledger.services import (
    Leg,
    get_member_account,
    get_system_account,
    post_transaction,
)

if TYPE_CHECKING:
    from moneyed import Money

    from bubble.ledger.models import Account
    from bubble.users.models import User

logger = logging.getLogger(__name__)

SALE_TYPES = (SalesType.SELL, SalesType.DONATE)
RENTAL_TYPES = (SalesType.RENT, SalesType.BORROW)
OPEN_STATES = (BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS)
REASON_MAX_LENGTH = 200


class SaleError(Exception):
    """A sale step is not possible; the message is user-facing."""

    def __init__(self, message):
        super().__init__(message)
        self.user_message = message


@dataclass(frozen=True)
class Price:
    amount: Money | None
    source: str


def agreed_amount(booking: Booking, *, until=None) -> Price:
    """What the booking costs: counter-offer, then offer, then the list price.

    Rentals use the booked duration, or the time up to ``until`` when the
    rental was open-ended. Sales use the item's price.
    """
    if booking.counter_offer is not None:
        return Price(booking.counter_offer, "counter_offer")
    if booking.offer is not None:
        return Price(booking.offer, "offer")
    item = booking.item
    if item.sales_type == SalesType.RENT:
        end = booking.time_to or until
        return Price(booking.rental_price_until(end), "rental_price")
    if item.sales_type in SALE_TYPES and item.price is not None:
        return Price(item.price, "item_price")
    return Price(None, "")


def _set_state(booking: Booking, state: str, note: str = "") -> None:
    booking.ledger_state = state
    booking.ledger_note = note[:255]


def _check_chargeable(price: Price, *, payment_enabled: bool) -> str | None:
    """Why nothing is charged, or None when the booking is chargeable."""
    if not payment_enabled:
        return "Payments are off for this item."
    if price.amount is None or price.amount.amount <= 0:
        return "Free of charge."
    return None


def _settle(  # noqa: PLR0913
    booking: Booking,
    *,
    price: Price,
    payer: User | None,
    payee: User | None,
    credit_community: bool,
    payment_enabled: bool,
    kind: str,
) -> Transaction | None:
    """Post the booking's charge, or record why it is not charged."""
    reason = _check_chargeable(price, payment_enabled=payment_enabled)
    if reason:
        _set_state(booking, BookingLedgerState.NOT_CHARGED, reason)
        return None
    if payer is None:
        _set_state(
            booking, BookingLedgerState.UNBILLED, "The booker is on another instance."
        )
        return None
    if not credit_community and payee is not None and payee.pk == payer.pk:
        _set_state(
            booking,
            BookingLedgerState.NOT_CHARGED,
            "Booked by the item's own owner.",
        )
        return None
    if not credit_community and payee is None:
        _set_state(
            booking,
            BookingLedgerState.UNBILLED,
            "The owner's account no longer exists.",
        )
        return None
    book = Book.objects.default()
    if str(price.amount.currency) != book.currency:
        _set_state(
            booking,
            BookingLedgerState.UNBILLED,
            f"Priced in {price.amount.currency}; the ledger uses {book.currency}.",
        )
        return None

    tx = _post_charge(
        booking,
        amount=price.amount,
        source=price.source,
        payer=payer,
        credit=(
            get_system_account(f"income:{'rental' if kind == 'rental' else 'sales'}")
            if credit_community
            else get_member_account(payee)
        ),
        kind=kind,
        book=book,
    )
    _set_state(booking, BookingLedgerState.POSTED)
    return tx


def _post_charge(  # noqa: PLR0913
    booking: Booking,
    *,
    amount: Money,
    source: str,
    payer: User,
    credit: Account,
    kind: str,
    book: Book,
) -> Transaction:
    item = booking.item
    payer_name = payer.name or payer.username
    if kind == "rental":
        description = f"Rental of {item.name} by {payer_name}"
        category_code = "rental"
    else:
        description = f"Purchase of {item.name} by {payer_name}"
        category_code = "sale"
    return post_transaction(
        book=book,
        kind=TransactionKind.BOOKING_CHARGE,
        occurred_on=timezone.localdate(),
        description=description,
        legs=[
            Leg(get_member_account(payer, book), amount, item=item),
            Leg(credit, -amount, item=item),
        ],
        category=Category.objects.get(book=book, code=category_code),
        source=("booking", str(booking.pk)),
        idempotency_key=f"booking:{booking.pk}:charge",
        meta={
            "booking": str(booking.pk),
            "item": str(item.pk),
            "amount_source": source,
        },
    )


def _reject_open_requests(booking: Booking, message: str, *, sender: User) -> None:
    """Turn down other pending requests for an item that changed hands.

    The note is sent in the name of whoever made the item change hands.
    """
    others = Booking.objects.filter(
        item_id=booking.item_id, status=BookingStatus.PENDING
    ).exclude(pk=booking.pk)
    for other in others:
        other.status = BookingStatus.REJECTED
        other.save(update_fields=["status", "updated_at"])
        Message.objects.create(booking=other, sender=sender, message=message)


# --- Sales ------------------------------------------------------------------


def accept_sale(booking: Booking) -> bool:
    """Freeze the sale terms and hand the item to the buyer (D17).

    Call right after the booking of a sale item became CONFIRMED. Returns
    whether the item changed hands. Nothing is charged yet: the buyer still
    has to approve the hand-over.
    """
    item = booking.item
    if (
        item.sales_type not in SALE_TYPES
        or booking.status != BookingStatus.CONFIRMED
        or booking.user_id is None  # remote buyer: no local owner (plan §6)
        or booking.user_id == item.user_id
        or booking.is_accepted_sale
    ):
        return False

    price = agreed_amount(booking)
    with transaction.atomic():
        booking.seller = item.user
        booking.sale_accepted_at = timezone.now()
        booking.agreed_price = price.amount
        booking.credit_community = (
            item.ledger_beneficiary == LedgerBeneficiary.COMMUNITY
        )
        if item.sales_type == SalesType.DONATE:
            reason = "Donation."
        else:
            reason = _check_chargeable(price, payment_enabled=item.payment_enabled)
        if reason:
            _set_state(booking, BookingLedgerState.NOT_CHARGED, reason)
        else:
            _set_state(booking, BookingLedgerState.PENDING)
        booking.save(
            update_fields=[
                "seller",
                "sale_accepted_at",
                "agreed_price",
                "agreed_price_currency",
                "credit_community",
                "ledger_state",
                "ledger_note",
                "updated_at",
            ]
        )
        item.transfer_ownership(booking.user)
        _reject_open_requests(
            booking, _("This item has been sold."), sender=booking.seller
        )
    logger.info("Sale %s accepted; %s now owns item %s", booking.pk, item.user, item.pk)
    return True


def approve_sale(booking: Booking) -> Transaction | None:
    """The buyer confirms the hand-over: complete the sale and charge it (D18)."""
    with transaction.atomic():
        booking.status = BookingStatus.COMPLETED
        tx = None
        if booking.ledger_state == BookingLedgerState.PENDING:
            tx = _settle(
                booking,
                price=Price(booking.agreed_price, "agreed_price"),
                payer=booking.user,
                payee=booking.seller,
                credit_community=booking.credit_community,
                payment_enabled=True,  # checked when the sale was accepted
                kind="sale",
            )
        booking.save(
            update_fields=["status", "ledger_state", "ledger_note", "updated_at"]
        )
    return tx


def reject_sale(booking: Booking, *, reason: str) -> None:
    """The buyer rejects the hand-over: cancel free of charge (D18).

    The item goes back to the seller as a draft, and back to the community if
    it was a community item.
    """
    item = booking.item
    passed_on = (
        Booking.objects.filter(item_id=item.pk, status__in=OPEN_STATES)
        .exclude(pk=booking.pk)
        .exists()
    )
    if passed_on:
        raise SaleError(
            _(
                "You have already passed this item on to someone else, so the "
                "sale can no longer be cancelled here."
            )
        )
    reason = reason.strip()[:REASON_MAX_LENGTH]
    with transaction.atomic():
        booking.status = BookingStatus.CANCELLED
        _set_state(
            booking,
            BookingLedgerState.NOT_CHARGED,
            f"The buyer reported a problem: {reason}",
        )
        booking.save(
            update_fields=["status", "ledger_state", "ledger_note", "updated_at"]
        )
        seller = booking.seller
        if seller is not None and item.user_id == booking.user_id:
            item.transfer_ownership(seller)
            if booking.credit_community:
                item.ledger_beneficiary = LedgerBeneficiary.COMMUNITY
                item.save(update_fields=["ledger_beneficiary"])
        _reject_open_requests(
            booking, _("This item is no longer available."), sender=booking.user
        )
        Message.objects.create(
            booking=booking,
            sender=booking.user,
            message=_("Problem reported, the sale is cancelled: {reason}").format(
                reason=reason
            ),
        )


# --- Rentals ----------------------------------------------------------------


def complete_rental(booking: Booking) -> Transaction | None:
    """Charge a rental that has just completed (D6)."""
    item = booking.item
    if (
        item.sales_type not in RENTAL_TYPES
        or booking.status != BookingStatus.COMPLETED
        or booking.ledger_state == BookingLedgerState.POSTED
    ):
        return None
    price = agreed_amount(booking, until=timezone.now())
    with transaction.atomic():
        booking.agreed_price = price.amount
        tx = _settle(
            booking,
            price=price,
            payer=booking.user,
            payee=item.user,
            credit_community=item.ledger_beneficiary == LedgerBeneficiary.COMMUNITY,
            payment_enabled=item.payment_enabled,
            kind="rental",
        )
        booking.save(
            update_fields=[
                "agreed_price",
                "agreed_price_currency",
                "ledger_state",
                "ledger_note",
                "updated_at",
            ]
        )
    return tx


# --- Reconciliation ---------------------------------------------------------

WAITING_SALE_DAYS = 14


@dataclass
class ReconciliationReport:
    """What the daily check found (plan section 6, "Reconciliation job")."""

    missing_charges: list[str]
    orphan_charges: list[str]
    unbilled: int
    waiting_sales: list[str]

    @property
    def ok(self) -> bool:
        return not self.missing_charges and not self.orphan_charges


def reconcile_booking_charges(now=None) -> ReconciliationReport:
    """Compare bookings marked as charged with the booking charges in the ledger."""
    now = now or timezone.now()
    posted = {
        str(pk)
        for pk in Booking.objects.filter(
            ledger_state=BookingLedgerState.POSTED
        ).values_list("pk", flat=True)
    }
    charged = set(
        Transaction.objects.filter(
            kind=TransactionKind.BOOKING_CHARGE, source_type="booking"
        ).values_list("source_id", flat=True)
    )
    waiting = Booking.objects.filter(
        status=BookingStatus.CONFIRMED,
        ledger_state=BookingLedgerState.PENDING,
        sale_accepted_at__lt=now - timedelta(days=WAITING_SALE_DAYS),
    ).values_list("pk", flat=True)
    return ReconciliationReport(
        missing_charges=sorted(posted - charged),
        orphan_charges=sorted(charged - posted),
        unbilled=Booking.objects.filter(
            ledger_state=BookingLedgerState.UNBILLED
        ).count(),
        waiting_sales=sorted(str(pk) for pk in waiting),
    )
