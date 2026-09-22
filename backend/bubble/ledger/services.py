"""The only write path into the ledger (plan section 5).

Nothing else constructs ``Transaction`` or ``Entry`` rows. Every function here
is atomic: it either writes a complete, balanced transaction and updates the
cached balances, or it writes nothing.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal
from typing import TYPE_CHECKING

from django.db import IntegrityError, connection
from django.db import transaction as db_transaction
from django.db.models import Count, Max, Sum
from django.utils import timezone
from moneyed import Money

from bubble.ledger.exceptions import (
    ClosedPeriodError,
    CurrencyMismatchError,
    NonZeroBalanceError,
    OverReversalError,
    UnbalancedTransactionError,
)
from bubble.ledger.models import (
    Account,
    AccountBalance,
    AccountType,
    Book,
    Entry,
    LedgerPeriod,
    Transaction,
    TransactionKind,
)
from bubble.ledger.rounding import CENT

if TYPE_CHECKING:
    from datetime import date

    from bubble.items.models import Item
    from bubble.ledger.models import Category, Project
    from bubble.users.models import User

logger = logging.getLogger(__name__)

# Names of the deferred constraint triggers created in migration 0001.
BALANCE_CONSTRAINTS = "ledger_entry_balanced, ledger_transaction_balanced"
# First key of the two-key advisory lock taken while reversing a transaction.
REVERSAL_LOCK = 0x1ED6E5


@dataclass(frozen=True)
class Leg:
    """One line of a transaction: a signed, debit-positive amount on an account."""

    account: Account
    amount: Money | Decimal
    item: Item | None = None
    memo: str = ""
    reverses_entry: Entry | None = None


@dataclass
class VerificationResult:
    trial_balance: Decimal
    mismatched_accounts: list[tuple[str, Decimal, Decimal]] = field(
        default_factory=list
    )

    @property
    def ok(self) -> bool:
        return self.trial_balance == 0 and not self.mismatched_accounts


def member_account_code(user: User) -> str:
    return f"member:{user.pk}"


def get_system_account(code: str, book: Book | None = None) -> Account:
    """Look up a seeded account such as ``asset:bank`` or ``income:rental``."""
    book = book or Book.objects.default()
    return Account.objects.get(book=book, code=code)


def get_member_account(user: User, book: Book | None = None) -> Account:
    """Return the user's member account, opening it on first use."""
    book = book or Book.objects.default()
    account = Account.objects.filter(book=book, owner=user).first()
    if account is not None:
        return account
    try:
        with db_transaction.atomic():
            account = Account.objects.create(
                book=book,
                type=AccountType.MEMBER,
                code=member_account_code(user),
                name=user.name or user.username,
                owner=user,
            )
            AccountBalance.objects.create(account=account)
    except IntegrityError:
        # Opened concurrently by another request; use that one.
        account = Account.objects.get(book=book, owner=user)
    return account


def _amount(leg: Leg, currency: str) -> Decimal:
    amount = leg.amount
    if isinstance(amount, Money):
        if str(amount.currency) != currency:
            msg = (
                f"Leg on {leg.account.code} is in {amount.currency}, "
                f"the book uses {currency}."
            )
            raise CurrencyMismatchError(msg)
        return amount.amount
    return Decimal(amount)


def _check_period_open(book: Book, occurred_on: date) -> None:
    closed = LedgerPeriod.objects.filter(
        book=book,
        closed_at__isnull=False,
        starts_on__lte=occurred_on,
        ends_on__gte=occurred_on,
    ).exists()
    if closed:
        msg = f"{occurred_on} falls inside a closed period; book it as a correction."
        raise ClosedPeriodError(msg)


def _check_database_constraints() -> None:
    """Run the deferred balance triggers now, then defer them again.

    The triggers normally fire at COMMIT. Checking right away makes a broken
    posting fail at the call site, and inside test transactions that are
    rolled back instead of committed.
    """
    with connection.cursor() as cursor:
        cursor.execute(f"SET CONSTRAINTS {BALANCE_CONSTRAINTS} IMMEDIATE")
        cursor.execute(f"SET CONSTRAINTS {BALANCE_CONSTRAINTS} DEFERRED")


def post_transaction(  # noqa: PLR0913
    *,
    kind: TransactionKind,
    occurred_on: date,
    description: str,
    legs: list[Leg],
    created_by: Account | None = None,
    category: Category | None = None,
    project: Project | None = None,
    source: tuple[str, str] | None = None,
    idempotency_key: str | None = None,
    meta: dict | None = None,
    reverses: Transaction | None = None,
    book: Book | None = None,
) -> Transaction:
    """Atomically write a balanced transaction and update the cached balances.

    Idempotent: when ``idempotency_key`` is already used in the book, the
    existing transaction is returned and nothing is written.
    """
    book = book or Book.objects.default()

    if idempotency_key:
        existing = Transaction.objects.filter(
            book=book, idempotency_key=idempotency_key
        ).first()
        if existing is not None:
            return existing

    amounts = [_amount(leg, book.currency) for leg in legs]
    if len(legs) < 2:  # noqa: PLR2004
        msg = "A transaction needs at least two legs."
        raise UnbalancedTransactionError(msg)
    if any(a == 0 for a in amounts):
        msg = "Zero-amount legs are not allowed."
        raise UnbalancedTransactionError(msg)
    if any(a != a.quantize(CENT) for a in amounts):
        # Would be silently rounded on save; split with rounding.allocate().
        msg = "Leg amounts must be whole cents."
        raise UnbalancedTransactionError(msg)
    if sum(amounts) != 0:
        msg = f"Legs sum to {sum(amounts)}, not 0."
        raise UnbalancedTransactionError(msg)
    for leg in legs:
        if leg.account.book_id != book.pk:
            msg = f"Account {leg.account.code} belongs to another book."
            raise UnbalancedTransactionError(msg)
    _check_period_open(book, occurred_on)

    source_type, source_id = source or ("", "")
    try:
        with db_transaction.atomic():
            tx = _write(
                book=book,
                kind=kind,
                occurred_on=occurred_on,
                description=description,
                legs=legs,
                amounts=amounts,
                created_by=created_by,
                category=category,
                project=project,
                source_type=source_type,
                source_id=str(source_id),
                idempotency_key=idempotency_key,
                meta=meta or {},
                reverses=reverses,
            )
    except IntegrityError:
        if idempotency_key:
            # Lost a race against an identical posting; return the winner.
            existing = Transaction.objects.filter(
                book=book, idempotency_key=idempotency_key
            ).first()
            if existing is not None:
                return existing
        raise
    logger.info("Posted ledger transaction %s (%s)", tx.seq, tx.get_kind_display())
    return tx


def _write(  # noqa: PLR0913
    *,
    book,
    kind,
    occurred_on,
    description,
    legs,
    amounts,
    created_by,
    category,
    project,
    source_type,
    source_id,
    idempotency_key,
    meta,
    reverses,
) -> Transaction:
    account_ids = sorted({leg.account.pk for leg in legs})
    for account_id in account_ids:
        AccountBalance.objects.get_or_create(account_id=account_id)
    # Lock in a fixed order so concurrent postings cannot deadlock.
    balances = {
        b.account_id: b
        for b in AccountBalance.objects.select_for_update()
        .filter(account_id__in=account_ids)
        .order_by("account_id")
    }

    tx = Transaction.objects.create(
        book=book,
        kind=kind,
        occurred_on=occurred_on,
        description=description,
        created_by=created_by,
        category=category,
        project=project,
        source_type=source_type,
        source_id=source_id,
        idempotency_key=idempotency_key or "",
        meta=meta,
        reverses=reverses,
    )
    Entry.objects.bulk_create(
        [
            Entry(
                transaction=tx,
                account=leg.account,
                amount=Money(amount, book.currency),
                item=leg.item,
                memo=leg.memo,
                reverses_entry=leg.reverses_entry,
            )
            for leg, amount in zip(legs, amounts, strict=True)
        ]
    )
    _check_database_constraints()

    tx.refresh_from_db(fields=["seq"])
    per_account: dict = defaultdict(lambda: [Decimal(0), 0])
    for leg, amount in zip(legs, amounts, strict=True):
        per_account[leg.account.pk][0] += amount
        per_account[leg.account.pk][1] += 1
    for account_id, (delta, count) in per_account.items():
        balance = balances[account_id]
        balance.balance += delta
        balance.entry_count += count
        balance.last_seq = tx.seq
        balance.save(update_fields=["balance", "entry_count", "last_seq", "updated_at"])
    return tx


def reversible_amounts(original: Transaction) -> dict[Entry, Decimal]:
    """What is left to undo of each entry of ``original``, as raw amounts."""
    undone = {
        row["reverses_entry"]: row["total"]
        for row in Entry.objects.filter(reverses_entry__transaction=original)
        .values("reverses_entry")
        .annotate(total=Sum("amount"))
    }
    return {
        entry: entry.amount.amount + undone.get(entry.pk, Decimal(0))
        for entry in original.entries.select_related("account")
    }


def reverse_transaction(  # noqa: PLR0913
    original: Transaction,
    *,
    created_by: Account | None,
    description: str = "",
    parts: dict[Entry, Decimal] | None = None,
    occurred_on: date | None = None,
    idempotency_key: str | None = None,
) -> Transaction:
    """Undo ``original``, fully or in part, with a new linked transaction.

    ``parts`` maps entries of ``original`` to the raw amount to undo, e.g.
    ``{dans_share: 15, alices_credit: -45 + 30}`` for "undo only Dan's share".
    Without ``parts`` everything that is still left is undone (a REVERSAL);
    with ``parts`` it is a CORRECTION. The original row is never touched.
    """
    with db_transaction.atomic():
        # Serialise reversals of the same original so two cannot both pass the
        # "what is left" check. An advisory lock, because SELECT ... FOR UPDATE
        # needs UPDATE privilege, which the app role does not get on ledger
        # tables in production.
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_advisory_xact_lock(%s, hashtext(%s))",
                [REVERSAL_LOCK, str(original.pk)],
            )
        remaining = reversible_amounts(original)

        if parts is None:
            kind = TransactionKind.REVERSAL
            parts = {entry: left for entry, left in remaining.items() if left != 0}
        else:
            kind = TransactionKind.CORRECTION

        legs = []
        for entry, amount in parts.items():
            if entry.transaction_id != original.pk:
                msg = f"Entry {entry.pk} is not part of transaction {original.pk}."
                raise OverReversalError(msg)
            amount = Decimal(amount)  # noqa: PLW2901
            left = remaining[entry]
            same_sign = (amount > 0) == (left > 0)
            if amount == 0 or not same_sign or abs(amount) > abs(left):
                msg = (
                    f"Cannot undo {amount} of the entry on {entry.account.code}: "
                    f"only {left} is left to undo."
                )
                raise OverReversalError(msg)
            legs.append(
                Leg(
                    account=entry.account,
                    amount=-amount,
                    item=entry.item,
                    memo=entry.memo,
                    reverses_entry=entry,
                )
            )
        if not legs:
            msg = f"Transaction {original.seq} has nothing left to reverse."
            raise OverReversalError(msg)

        verb = "Reversal" if kind == TransactionKind.REVERSAL else "Correction"
        return post_transaction(
            book=original.book,
            kind=kind,
            occurred_on=occurred_on or timezone.localdate(),
            description=description or f"{verb} of #{original.seq}",
            legs=legs,
            created_by=created_by,
            category=original.category,
            project=original.project,
            idempotency_key=idempotency_key,
            reverses=original,
        )


def release_member_account(user: User) -> Account | None:
    """Detach a leaving member's account from their user (plan section 14).

    The account and all its entries stay, renamed to 'Former member …'. A
    member who still owes or is owed money cannot leave until it is settled.
    """
    account = Account.objects.filter(owner=user).first()
    if account is None:
        return None
    balance = AccountBalance.objects.filter(account=account).first()
    raw = balance.balance if balance else Decimal(0)
    if raw != 0:
        msg = (
            f"{account.name} has a balance of {account.display(raw)} "
            f"{account.book.currency}; settle it before the account can be removed."
        )
        raise NonZeroBalanceError(msg)
    account.name = f"Former member #{str(account.pk)[:8]}"
    account.owner = None
    account.is_active = False
    account.save(update_fields=["name", "owner", "is_active"])
    return account


def verify_ledger(book: Book | None = None) -> VerificationResult:
    """Check invariants I7 (trial balance is zero) and I8 (cache = recomputed)."""
    book = book or Book.objects.default()
    recomputed = {
        row["account"]: (row["total"], row["count"], row["last"])
        for row in Entry.objects.filter(account__book=book)
        .values("account")
        .annotate(total=Sum("amount"), count=Count("id"), last=Max("transaction__seq"))
    }
    trial = sum((total for total, _, _ in recomputed.values()), Decimal(0))
    result = VerificationResult(trial_balance=trial)
    for balance in AccountBalance.objects.filter(account__book=book).select_related(
        "account"
    ):
        expected = recomputed.get(balance.account_id, (Decimal(0), 0, None))[0]
        if balance.balance != expected:
            result.mismatched_accounts.append(
                (balance.account.code, balance.balance, expected)
            )
    return result
