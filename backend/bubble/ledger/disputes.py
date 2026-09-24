"""Disputes, comments and corrections: the trust layer (plan D9, section 11).

A posted transaction is never changed. Any member may dispute it or comment
on it; the people it credits, its author and the treasurer may answer with a
full reversal, a partial correction, or by keeping it with an explanation.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.db import IntegrityError
from django.db import transaction as db_transaction
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from bubble.ledger.exceptions import OverReversalError, UnbalancedTransactionError
from bubble.ledger.intents import IntentError, IntentForbiddenError, is_ledger_admin
from bubble.ledger.models import (
    AccountType,
    Dispute,
    DisputeState,
    Entry,
    Transaction,
    TransactionComment,
    TransactionKind,
)
from bubble.ledger.notify import display_name, notify, notify_posting
from bubble.ledger.services import (
    get_member_account,
    reverse_transaction,
    reversible_amounts,
)

if TYPE_CHECKING:
    from decimal import Decimal

    from bubble.users.models import User

MAX_TEXT = 2000
CORRECTION_KINDS = (TransactionKind.REVERSAL, TransactionKind.CORRECTION)


def involved_users(tx: Transaction) -> list[User]:
    """The author and every member whose balance the transaction touches."""
    users = {}
    if tx.created_by_id and tx.created_by.owner:
        users[tx.created_by.owner.pk] = tx.created_by.owner
    for entry in tx.entries.select_related("account__owner"):
        owner = entry.account.owner
        if owner is not None:
            users[owner.pk] = owner
    return list(users.values())


def can_reverse(tx: Transaction, user: User) -> bool:
    """Author, treasurer, or a member the transaction credits (they give it back).

    Reversals and corrections themselves are not reversed again; a mistake in
    one is fixed with a new entry.
    """
    if tx.kind in CORRECTION_KINDS:
        return False
    if is_ledger_admin(user):
        return True
    if tx.created_by_id and tx.created_by.owner_id == user.pk:
        return True
    return tx.entries.filter(
        account__owner=user,
        account__type=AccountType.MEMBER,
        amount__lt=0,
    ).exists()


def _text(value: str, field: str) -> str:
    value = (value or "").strip()
    if not value:
        raise IntentError(_("Please write a few words."), field=field)
    return value[:MAX_TEXT]


def _notify_dispute_closed(dispute: Dispute, resolution: str) -> None:
    notify(
        dispute.raised_by.owner,
        "dispute_resolved",
        path=f"/ledger/t/{dispute.transaction_id}",
        description=dispute.transaction.description,
        resolution=resolution,
    )


def _close_open_disputes(tx: Transaction, state: str, *, by, resolution: str) -> None:
    for dispute in tx.disputes.filter(state=DisputeState.OPEN).select_related(
        "raised_by__owner"
    ):
        dispute.state = state
        dispute.resolved_at = timezone.now()
        dispute.resolved_by = by
        dispute.resolution = resolution
        dispute.save()
        _notify_dispute_closed(dispute, resolution)


# --- Disputes ---------------------------------------------------------------


def raise_dispute(tx: Transaction, user: User, reason: str) -> Dispute:
    reason = _text(reason, "reason")
    me = get_member_account(user, tx.book)
    try:
        with db_transaction.atomic():
            dispute = Dispute.objects.create(
                transaction=tx, raised_by=me, reason=reason
            )
    except IntegrityError as exc:
        raise IntentError(
            _("You already have an open dispute on this transaction."), field="reason"
        ) from exc
    for person in involved_users(tx):
        if person.pk != user.pk:
            notify(
                person,
                "disputed",
                path=f"/ledger/t/{tx.pk}",
                actor=display_name(user),
                description=tx.description,
                reason=reason,
            )
    return dispute


def withdraw_dispute(dispute: Dispute, user: User) -> Dispute:
    if dispute.raised_by.owner_id != user.pk:
        raise IntentForbiddenError(_("Only the member who raised it can withdraw it."))
    if dispute.state != DisputeState.OPEN:
        raise IntentError(_("This dispute is already closed."))
    dispute.state = DisputeState.WITHDRAWN
    dispute.resolved_at = timezone.now()
    dispute.resolved_by = dispute.raised_by
    dispute.save()
    return dispute


def uphold_dispute(dispute: Dispute, user: User, resolution: str) -> Dispute:
    """Keep the transaction as it is, and say why."""
    tx = dispute.transaction
    if not can_reverse(tx, user):
        raise IntentForbiddenError(
            _("Only the author, the members it credits or the treasurer can answer.")
        )
    if dispute.state != DisputeState.OPEN:
        raise IntentError(_("This dispute is already closed."))
    resolution = _text(resolution, "resolution")
    dispute.state = DisputeState.UPHELD
    dispute.resolved_at = timezone.now()
    dispute.resolved_by = get_member_account(user, tx.book)
    dispute.resolution = resolution
    dispute.save()
    _notify_dispute_closed(dispute, resolution)
    return dispute


# --- Reversals and corrections ------------------------------------------------


def _check_can_reverse(tx: Transaction, user: User) -> None:
    if tx.kind in CORRECTION_KINDS:
        raise IntentError(
            _("Corrections are not reversed again; post a new entry instead.")
        )
    if not can_reverse(tx, user):
        raise IntentForbiddenError(
            _("Only the author, the members it credits or the treasurer can do this.")
        )


def reverse(tx: Transaction, user: User, description: str = "") -> Transaction:
    """Undo everything that is left of ``tx``; open disputes count as resolved."""
    _check_can_reverse(tx, user)
    me = get_member_account(user, tx.book)
    try:
        with db_transaction.atomic():
            reversal = reverse_transaction(
                tx, created_by=me, description=description.strip()[:MAX_TEXT]
            )
            _close_open_disputes(
                tx, DisputeState.REVERSED, by=me, resolution=_("Reversed.")
            )
            notify_posting(reversal, actor=user)
    except OverReversalError as exc:
        raise IntentError(_("There is nothing left to reverse.")) from exc
    return reversal


def correct(
    tx: Transaction,
    user: User,
    lines: list[tuple[Entry, Decimal]],
    description: str = "",
) -> Transaction:
    """Undo part of ``tx``: ``lines`` are (entry, amount to undo) pairs.

    Amounts are magnitudes; the direction follows the entry. The lines must
    balance, e.g. undo Dan's 15 € share and 15 € of Alice's credit.
    """
    _check_can_reverse(tx, user)
    if not lines:
        raise IntentError(_("Choose what to correct."), field="lines")
    remaining = reversible_amounts(tx)
    parts: dict[Entry, Decimal] = {}
    for entry, magnitude in lines:
        if entry.transaction_id != tx.pk:
            raise IntentError(_("That line is not part of this transaction."))
        if magnitude <= 0:
            continue
        left = remaining[entry]
        parts[entry] = magnitude if left > 0 else -magnitude
    if not parts:
        raise IntentError(_("Choose what to correct."), field="lines")
    me = get_member_account(user, tx.book)
    try:
        with db_transaction.atomic():
            correction = reverse_transaction(
                tx,
                created_by=me,
                parts=parts,
                description=description.strip()[:MAX_TEXT],
            )
            _close_open_disputes(
                tx,
                DisputeState.CORRECTED,
                by=me,
                resolution=_("Corrected: {description}").format(
                    description=correction.description
                ),
            )
            notify_posting(correction, actor=user)
    except OverReversalError as exc:
        raise IntentError(
            _("That undoes more than is left of a line."), field="lines"
        ) from exc
    except UnbalancedTransactionError as exc:
        raise IntentError(
            _(
                "The corrected amounts must balance: what one side gives back, the "
                "other side takes back."
            ),
            field="lines",
        ) from exc
    return correction


# --- Comments -----------------------------------------------------------------


def add_comment(tx: Transaction, user: User, body: str) -> TransactionComment:
    body = _text(body, "body")
    comment = TransactionComment.objects.create(
        transaction=tx, author=get_member_account(user, tx.book), body=body
    )
    people = {u.pk: u for u in involved_users(tx)}
    for dispute in tx.disputes.select_related("raised_by__owner"):
        if dispute.raised_by.owner:
            people[dispute.raised_by.owner.pk] = dispute.raised_by.owner
    for person in people.values():
        if person.pk != user.pk:
            notify(
                person,
                "comment",
                path=f"/ledger/t/{tx.pk}",
                actor=display_name(user),
                description=tx.description,
                comment=body[:200],
            )
    return comment
