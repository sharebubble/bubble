"""Shared expenses: charging other members, with their consent (plan 7a, D13).

A member who paid for something shared (a group dinner, festival tickets)
splits it. Every participant is told their exact share and may accept or
object; silence counts as acceptance after COST_SHARE_AUTO_ACCEPT_DAYS. Then
the split posts one SHARED_EXPENSE transaction: each participant is charged
their share and the payer is credited the sum.

An objection removes only the objector's share; the payer carries it and may
edit or cancel the split. Nobody else's share changes without them being told.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING

from constance import config
from django.db import transaction as db_transaction
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from moneyed import Money

from bubble.ledger.intents import (
    MAX_AMOUNT,
    MAX_RECEIPTS,
    IntentError,
    IntentForbiddenError,
    is_ledger_admin,
    read_receipt,
    store_receipt,
)
from bubble.ledger.models import (
    Account,
    AccountType,
    Book,
    Category,
    CategoryKind,
    CostShare,
    CostShareParticipant,
    CostShareSplit,
    CostShareState,
    ParticipantResponse,
    Receipt,
    Transaction,
    TransactionKind,
)
from bubble.ledger.notify import display_name, money, notify, notify_posting
from bubble.ledger.rounding import CENT, allocate
from bubble.ledger.services import (
    Leg,
    get_member_account,
    is_period_closed,
    post_transaction,
)

if TYPE_CHECKING:
    from datetime import date

    from django.core.files.uploadedfile import UploadedFile

    from bubble.ledger.models import Project
    from bubble.users.models import User

REMIND_BEFORE_DEADLINE = timedelta(days=1)
MAX_PARTICIPANTS = 100


@dataclass(frozen=True)
class ParticipantInput:
    account: Account
    weight: Decimal = Decimal(1)
    amount: Decimal | None = None
    guests: int = 0


@dataclass(frozen=True)
class CostShareInput:
    description: str
    total: Decimal
    occurred_on: date
    participants: list[ParticipantInput]
    split: str = CostShareSplit.EQUAL
    category: Category | None = None
    project: Project | None = None
    payer_participates: bool = True
    payer_weight: Decimal = Decimal(1)
    payer_guests: int = 0


# --- Shares -----------------------------------------------------------------


def compute_shares(cs: CostShare) -> tuple[dict[str, Decimal], Decimal]:
    """Each participant's share (by participant id) and the payer's own share.

    Objected participants keep their computed share here; they are simply not
    charged, so an objection never changes anybody else's share.
    """
    participants = list(cs.participants.all())
    total = cs.total.amount
    if cs.split == CostShareSplit.AMOUNTS:
        shares = {
            str(p.pk): (p.amount.amount if p.amount is not None else Decimal(0))
            for p in participants
        }
        return shares, total - sum(shares.values(), Decimal(0))

    def units(weight: Decimal, guests: int) -> Decimal:
        base = Decimal(1) if cs.split == CostShareSplit.EQUAL else weight
        return base * (1 + guests)

    weights = [units(p.weight, p.guests) for p in participants]
    payer_units = (
        units(cs.payer_weight, cs.payer_guests) if cs.payer_participates else Decimal(0)
    )
    parts = allocate(total, [*weights, payer_units])
    shares = {str(p.pk): part for p, part in zip(participants, parts, strict=False)}
    return shares, parts[-1]


# --- Validation -------------------------------------------------------------


def _validate_participants(
    participants: list[ParticipantInput], payer: Account, book: Book
) -> None:
    seen = set()
    for p in participants:
        account = p.account
        if (
            account.book_id != book.pk
            or account.type != AccountType.MEMBER
            or not account.is_active
        ):
            raise IntentError(_("Pick active members."), field="participants")
        if account.pk == payer.pk:
            raise IntentError(
                _("You pay; add yourself with 'I take part too' instead."),
                field="participants",
            )
        if account.pk in seen:
            raise IntentError(_("Each member only once."), field="participants")
        seen.add(account.pk)
        if p.guests < 0 or p.weight <= 0:
            raise IntentError(_("Weights must be positive."), field="participants")


def _validate_date(day: date, book: Book) -> None:
    if day > timezone.localdate():
        raise IntentError(_("The date cannot be in the future."), field="occurred_on")
    if is_period_closed(book, day):
        raise IntentError(
            _("This date lies in a closed bookkeeping period."), field="occurred_on"
        )


def _validate(data: CostShareInput, payer: Account, book: Book) -> None:
    total = data.total
    if total <= 0 or total != total.quantize(CENT):
        raise IntentError(_("Enter a positive amount in cents."), field="total")
    if total > MAX_AMOUNT:
        raise IntentError(_("This amount is too large."), field="total")
    _validate_date(data.occurred_on, book)
    if not data.description.strip():
        raise IntentError(_("Describe what this is for."), field="description")
    if data.split not in CostShareSplit.values:
        raise IntentError(_("Choose how to split."), field="split")
    if not data.participants:
        raise IntentError(_("Add at least one other member."), field="participants")
    if len(data.participants) > MAX_PARTICIPANTS:
        raise IntentError(_("Too many participants."), field="participants")
    _validate_participants(data.participants, payer, book)
    if data.split == CostShareSplit.AMOUNTS:
        amounts = [p.amount for p in data.participants]
        if any(a is None or a <= 0 or a != a.quantize(CENT) for a in amounts):
            raise IntentError(
                _("Enter an amount in cents for every participant."),
                field="participants",
            )
        if sum(amounts, Decimal(0)) > total:
            raise IntentError(
                _("The participants' amounts exceed the total."), field="participants"
            )
    if data.category is not None and (
        data.category.book_id != book.pk
        or data.category.kind not in (CategoryKind.EXPENSE, CategoryKind.TRANSFER)
    ):
        raise IntentError(_("Pick an expense category."), field="category")
    if data.project is not None and (
        data.project.book_id != book.pk or data.project.is_archived
    ):
        raise IntentError(_("This project is closed."), field="project")


def _write_participants(cs: CostShare, data: CostShareInput) -> None:
    for p in data.participants:
        CostShareParticipant.objects.create(
            cost_share=cs,
            account=p.account,
            weight=p.weight,
            amount=(
                Money(p.amount, cs.total.currency)
                if cs.split == CostShareSplit.AMOUNTS
                else None
            ),
            guests=p.guests,
        )


def _deadline() -> datetime:
    return timezone.now() + timedelta(days=config.COST_SHARE_AUTO_ACCEPT_DAYS)


def _tell_participants(cs: CostShare, kind: str, payer: User) -> None:
    shares, _payer_share = compute_shares(cs)
    for p in cs.participants.select_related("account__owner"):
        notify(
            p.account.owner,
            kind,
            path=f"/ledger/splits/{cs.pk}",
            actor=display_name(payer),
            description=cs.description,
            amount=money(shares[str(p.pk)], str(cs.total.currency)),
            deadline=timezone.localdate(cs.auto_accept_at),
        )


# --- Lifecycle --------------------------------------------------------------


def create_cost_share(
    data: CostShareInput,
    *,
    user: User,
    receipts: list[UploadedFile] = (),
    book: Book | None = None,
) -> CostShare:
    book = book or Book.objects.default()
    payer = get_member_account(user, book)
    _validate(data, payer, book)
    if len(receipts) > MAX_RECEIPTS:
        raise IntentError(
            _("Attach at most %(count)d receipts.") % {"count": MAX_RECEIPTS},
            field="receipts",
        )
    receipt_data = [read_receipt(f) for f in receipts]
    with db_transaction.atomic():
        cs = CostShare.objects.create(
            book=book,
            payer=payer,
            description=data.description.strip(),
            occurred_on=data.occurred_on,
            total=Money(data.total, book.currency),
            category=data.category,
            project=data.project,
            split=data.split,
            payer_participates=data.payer_participates,
            payer_weight=data.payer_weight,
            payer_guests=data.payer_guests,
            auto_accept_at=_deadline(),
        )
        _write_participants(cs, data)
        for receipt in receipt_data:
            store_receipt(None, payer, receipt, cost_share=cs)
        _tell_participants(cs, "cost_share_added", user)
    return cs


def _lock_open(cs: CostShare) -> CostShare:
    cs = CostShare.objects.select_for_update().get(pk=cs.pk)
    if cs.state != CostShareState.OPEN:
        raise IntentError(_("This split is already closed."))
    return cs


def update_cost_share(cs: CostShare, data: CostShareInput, *, user: User) -> CostShare:
    """The payer changes an open split; everyone is asked again."""
    with db_transaction.atomic():
        cs = _lock_open(cs)
        if cs.payer.owner_id != user.pk:
            raise IntentForbiddenError(_("Only the payer can change this split."))
        _validate(data, cs.payer, cs.book)
        cs.description = data.description.strip()
        cs.occurred_on = data.occurred_on
        cs.total = Money(data.total, cs.total.currency)
        cs.category = data.category
        cs.project = data.project
        cs.split = data.split
        cs.payer_participates = data.payer_participates
        cs.payer_weight = data.payer_weight
        cs.payer_guests = data.payer_guests
        cs.auto_accept_at = _deadline()
        cs.save()
        cs.participants.all().delete()
        _write_participants(cs, data)
        _tell_participants(cs, "cost_share_changed", user)
    return cs


def respond(cs: CostShare, *, user: User, accept: bool, reason: str = "") -> CostShare:
    """A participant accepts or objects; the split posts once all have answered."""
    with db_transaction.atomic():
        cs = _lock_open(cs)
        participant = cs.participants.filter(account__owner=user).first()
        if participant is None:
            raise IntentForbiddenError(_("You are not part of this split."))
        if not accept and not reason.strip():
            raise IntentError(_("Tell the payer what is wrong."), field="reason")
        participant.response = (
            ParticipantResponse.ACCEPTED if accept else ParticipantResponse.OBJECTED
        )
        participant.responded_at = timezone.now()
        participant.objection_reason = "" if accept else reason.strip()[:2000]
        participant.save()
        if not accept:
            notify(
                cs.payer.owner,
                "cost_share_objected",
                path=f"/ledger/splits/{cs.pk}",
                actor=display_name(user),
                description=cs.description,
                reason=participant.objection_reason,
            )
        if not cs.participants.filter(response=ParticipantResponse.PENDING).exists():
            _post(cs)
    return cs


def cancel_cost_share(cs: CostShare, *, user: User, reason: str = "") -> CostShare:
    with db_transaction.atomic():
        cs = _lock_open(cs)
        if cs.payer.owner_id != user.pk and not is_ledger_admin(user):
            raise IntentForbiddenError(_("Only the payer can cancel this split."))
        cs.state = CostShareState.CANCELLED
        cs.cancelled_reason = reason.strip()[:2000]
        cs.save()
        for p in cs.participants.select_related("account__owner"):
            notify(
                p.account.owner,
                "cost_share_cancelled",
                path=f"/ledger/splits/{cs.pk}",
                actor=display_name(user),
                description=cs.description,
            )
    return cs


def add_cost_share_receipt(
    cs: CostShare, upload: UploadedFile, *, user: User
) -> Receipt:
    if cs.payer.owner_id != user.pk:
        raise IntentForbiddenError(_("Only the payer can add receipts."))
    if cs.receipts.count() >= MAX_RECEIPTS:
        raise IntentError(
            _("Attach at most %(count)d receipts.") % {"count": MAX_RECEIPTS},
            field="receipts",
        )
    return store_receipt(None, cs.payer, read_receipt(upload), cost_share=cs)


def _post(cs: CostShare) -> Transaction | None:
    """Book an answered split. Runs inside the caller's locked transaction."""
    shares, _payer_share = compute_shares(cs)
    charged = [
        (p, shares[str(p.pk)])
        for p in cs.participants.select_related("account")
        if p.response != ParticipantResponse.OBJECTED and shares[str(p.pk)] > 0
    ]
    if not charged:
        cs.state = CostShareState.CANCELLED
        cs.cancelled_reason = "Nobody was left to charge."
        cs.save()
        return None
    currency = str(cs.total.currency)
    total_charged = sum((share for _p, share in charged), Decimal(0))
    category = cs.category or Category.objects.get(book=cs.book, code="shared-expense")
    tx = post_transaction(
        book=cs.book,
        kind=TransactionKind.SHARED_EXPENSE,
        occurred_on=cs.occurred_on,
        description=cs.description,
        legs=[
            *(Leg(p.account, Money(share, currency)) for p, share in charged),
            Leg(cs.payer, Money(-total_charged, currency), memo="paid"),
        ],
        created_by=cs.payer,
        category=category,
        project=cs.project,
        source=("cost_share", str(cs.pk)),
        idempotency_key=f"cost_share:{cs.pk}",
        meta={
            "cost_share": str(cs.pk),
            "split": cs.split,
            "total": str(cs.total.amount),
        },
    )
    cs.state = CostShareState.POSTED
    cs.posted_transaction = tx
    cs.save()
    notify_posting(tx, actor=None)
    return tx


# --- Deadlines --------------------------------------------------------------


def process_cost_share_deadlines(now=None) -> tuple[int, int]:
    """Remind silent participants a day before, and post splits past the deadline.

    Returns ``(reminders_sent, splits_posted)``. Idempotent.
    """
    now = now or timezone.now()
    reminded = posted = 0
    open_ids = CostShare.objects.filter(state=CostShareState.OPEN).values_list(
        "pk", flat=True
    )
    for pk in open_ids:
        with db_transaction.atomic():
            cs = (
                CostShare.objects.select_for_update(skip_locked=True)
                .filter(pk=pk, state=CostShareState.OPEN)
                .first()
            )
            if cs is None:
                continue
            pending = cs.participants.filter(response=ParticipantResponse.PENDING)
            if cs.auto_accept_at <= now:
                pending.update(response=ParticipantResponse.ACCEPTED, responded_at=now)
                if _post(cs) is not None:
                    posted += 1
                continue
            if cs.auto_accept_at - now <= REMIND_BEFORE_DEADLINE:
                shares, _payer_share = compute_shares(cs)
                for p in pending.filter(reminded_at__isnull=True).select_related(
                    "account__owner"
                ):
                    notify(
                        p.account.owner,
                        "cost_share_reminder",
                        path=f"/ledger/splits/{cs.pk}",
                        description=cs.description,
                        amount=money(shares[str(p.pk)], str(cs.total.currency)),
                        deadline=timezone.localdate(cs.auto_accept_at),
                    )
                    p.reminded_at = now
                    p.save(update_fields=["reminded_at"])
                    reminded += 1
    return reminded, posted
