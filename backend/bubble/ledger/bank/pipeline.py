"""Bank statement lines into the ledger (plan section 12).

``ingest`` stores new lines from any source and proposes a match for each;
the treasurer then decides per line:

* **book** it: a member's top-up or payout, or community income or expense;
* **link** it to an entry someone already posted by hand for the same money;
* **park** it in ``suspense:unmatched`` so the bank account in the books
  matches the real one while nobody knows yet what it was — and **assign** it
  later, which moves it out of suspense;
* **ignore** it, e.g. a line from before the ledger started.

Postings use ``statement_line:<id>`` idempotency keys, so a line can never be
booked twice, not even by two treasurers at once.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import TYPE_CHECKING

from constance import config
from django.db import transaction as db_transaction
from django.utils import timezone
from django.utils.translation import gettext
from django.utils.translation import gettext_lazy as _

from bubble.ledger.bank.matching import link_candidates, propose
from bubble.ledger.bank.sources import (
    BankStatementSource,
    StatementParseError,
    file_source,
    fingerprints,
)
from bubble.ledger.intents import IntentError, IntentForbiddenError, is_ledger_admin
from bubble.ledger.models import (
    Account,
    AccountType,
    Book,
    Category,
    CategoryKind,
    KnownIban,
    LineState,
    MatchConfidence,
    StatementImport,
    StatementLine,
    Transaction,
    TransactionKind,
)
from bubble.ledger.notify import notify_posting
from bubble.ledger.services import (
    Leg,
    get_member_account,
    get_system_account,
    is_period_closed,
    post_transaction,
)

if TYPE_CHECKING:
    from collections.abc import Sequence
    from datetime import date

    from bubble.ledger.bank.sources import ParsedLine
    from bubble.users.models import User

MAX_FILE_SIZE = 5 * 1024 * 1024


@dataclass
class ImportResult:
    statement: StatementImport
    duplicates: int
    booked: int


def _require_treasurer(user: User) -> None:
    if not is_ledger_admin(user):
        raise IntentForbiddenError(_("Only the treasurer can import bank statements."))


def import_file(
    content: bytes, file_name: str, *, user: User, book: Book | None = None
) -> ImportResult:
    """Read an uploaded statement file and ingest its lines."""
    _require_treasurer(user)
    book = book or Book.objects.default()
    if len(content) > MAX_FILE_SIZE:
        raise StatementParseError(_("The file is larger than 5 MB."))
    sha256 = hashlib.sha256(content).hexdigest()
    if StatementImport.objects.filter(book=book, sha256=sha256).exists():
        raise StatementParseError(_("This file has already been imported."))
    source = file_source(content, file_name)
    lines = source.read(content)
    return ingest(
        book, source, lines, user=user, file_name=file_name[:255], sha256=sha256
    )


def ingest(  # noqa: PLR0913
    book: Book,
    source: BankStatementSource,
    lines: Sequence[ParsedLine],
    *,
    user: User | None,
    file_name: str = "",
    sha256: str = "",
) -> ImportResult:
    """Store the lines not seen before and propose a match for each.

    Any source, file or bank adapter, ends up here.
    """
    prints = fingerprints(list(lines))
    known = set(
        StatementLine.objects.filter(book=book, fingerprint__in=prints).values_list(
            "fingerprint", flat=True
        )
    )
    actor = get_member_account(user, book) if user else None
    with db_transaction.atomic():
        statement = StatementImport.objects.create(
            book=book,
            source=source.name,
            file_name=file_name,
            sha256=sha256 or hashlib.sha256("".join(prints).encode()).hexdigest(),
            imported_by=actor,
            line_count=len(lines),
        )
        created = []
        for parsed, fingerprint in zip(lines, prints, strict=True):
            if fingerprint in known:
                continue
            known.add(fingerprint)
            created.append(
                StatementLine.objects.create(
                    book=book,
                    statement=statement,
                    fingerprint=fingerprint,
                    booked_on=parsed.booked_on,
                    value_date=parsed.value_date,
                    amount=parsed.amount,
                    currency=parsed.currency or book.currency,
                    counterparty_name=parsed.counterparty_name,
                    counterparty_iban=parsed.counterparty_iban,
                    reference=parsed.reference,
                    end_to_end_id=parsed.end_to_end_id,
                    raw=parsed.raw,
                )
            )
        statement.new_line_count = len(created)
        statement.save(update_fields=["new_line_count"])
        for line in created:
            _store_proposal(line)
    booked = _auto_confirm(created, user) if user else 0
    return ImportResult(statement, len(lines) - len(created), booked)


def _store_proposal(line: StatementLine) -> None:
    proposal = propose(line)
    line.proposed_account = proposal.account
    line.proposed_transaction = proposal.transaction
    line.confidence = proposal.confidence
    line.reason = proposal.reason[:255]
    line.save(
        update_fields=[
            "proposed_account",
            "proposed_transaction",
            "confidence",
            "reason",
        ]
    )


def _auto_confirm(lines: list[StatementLine], user: User) -> int:
    """Book high-confidence lines right away, if the treasurer turned that on."""
    if not config.BANK_AUTO_CONFIRM_REFERENCES:
        return 0
    done = 0
    for line in lines:
        if line.confidence != MatchConfidence.HIGH:
            continue
        try:
            if line.proposed_transaction is not None:
                link_line(line, line.proposed_transaction, user=user)
            elif line.amount > 0:
                book_line(line, user=user, account=line.proposed_account)
            else:
                continue
        except IntentError:
            continue
        done += 1
    return done


def refresh_proposals(book: Book | None = None) -> int:
    """Propose again for every open line, e.g. after members were added."""
    book = book or Book.objects.default()
    lines = StatementLine.objects.filter(book=book, state=LineState.OPEN)
    for line in lines:
        _store_proposal(line)
    return len(lines)


# --- Decisions ----------------------------------------------------------------


def _locked(line: StatementLine, *states: str) -> StatementLine:
    line = StatementLine.objects.select_for_update().get(pk=line.pk)
    if line.state not in states:
        raise IntentError(
            _("This line has already been dealt with (%(state)s).")
            % {"state": LineState(line.state).label},
            field="state",
        )
    return line


def _check_currency(line: StatementLine) -> None:
    if line.currency != line.book.currency:
        raise IntentError(
            _(
                "This line is in %(currency)s; the books are kept in %(book)s. "
                "Book it by hand in %(book)s and ignore the line."
            )
            % {"currency": line.currency, "book": line.book.currency},
            field="currency",
        )


def _posting_date(line: StatementLine) -> tuple[date, str]:
    """The bank's booking date, or today when that period is already closed."""
    if is_period_closed(line.book, line.booked_on):
        note = gettext("Booked by the bank on %(date)s (closed period).") % {
            "date": line.booked_on.isoformat()
        }
        return timezone.localdate(), note
    return line.booked_on, ""


def _description(line: StatementLine, description: str) -> str:
    text = description.strip() or line.reference.strip() or line.counterparty_name
    return (text or gettext("Bank transfer"))[:500]


def _target_legs(
    line: StatementLine,
    cash: Account,
    *,
    account: Account | None,
    category: Category | None,
) -> tuple[list[Leg], TransactionKind, Category | None]:
    """Legs moving the line's money between ``cash`` (bank or suspense) and the
    member or category. ``amount`` > 0: money came in."""
    amount = line.amount
    book = line.book
    if (account is None) == (category is None):
        raise IntentError(_("Pick a member or a category."), field="account")
    if account is not None:
        if (
            account.book_id != book.pk
            or account.type != AccountType.MEMBER
            or not account.is_active
        ):
            raise IntentError(_("Pick an active member."), field="account")
        # In: the member paid in (credit them). Out: they were paid (debit).
        kind = TransactionKind.TOP_UP if amount > 0 else TransactionKind.PAYOUT
        code = "top-up" if amount > 0 else "payout"
        return (
            [Leg(cash, amount), Leg(account, -amount)],
            kind,
            Category.objects.get(book=book, code=code),
        )
    expected = CategoryKind.INCOME if amount > 0 else CategoryKind.EXPENSE
    if (
        category.book_id != book.pk
        or category.kind != expected
        or category.account_id is None
        or not category.is_active
    ):
        raise IntentError(
            _(
                "Money coming in needs an income category, money going out "
                "an expense category."
            ),
            field="category",
        )
    kind = TransactionKind.INCOME if amount > 0 else TransactionKind.EXPENSE
    return [Leg(cash, amount), Leg(category.account, -amount)], kind, category


def _post(  # noqa: PLR0913
    line: StatementLine,
    *,
    user: User,
    legs: list[Leg],
    kind: TransactionKind,
    category: Category | None,
    description: str,
    key: str,
) -> Transaction:
    occurred_on, note = _posting_date(line)
    actor = get_member_account(user, line.book)
    return post_transaction(
        book=line.book,
        kind=kind,
        occurred_on=occurred_on,
        description=description,
        legs=legs,
        created_by=actor,
        category=category,
        source=("statement_line", str(line.pk)),
        idempotency_key=key,
        meta={
            "bank_line": str(line.pk),
            "booked_by_bank_on": line.booked_on.isoformat(),
            **({"note": note} if note else {}),
        },
    )


def _resolve(line: StatementLine, user: User, state: str, **fields) -> StatementLine:
    line.state = state
    line.resolved_by = get_member_account(user, line.book)
    line.resolved_at = timezone.now()
    for name, value in fields.items():
        setattr(line, name, value)
    line.save()
    return line


def _learn_iban(line: StatementLine, account: Account | None) -> None:
    if account is not None and line.counterparty_iban:
        KnownIban.objects.update_or_create(
            book=line.book, iban=line.counterparty_iban, defaults={"account": account}
        )


def book_line(
    line: StatementLine,
    *,
    user: User,
    account: Account | None = None,
    category: Category | None = None,
    description: str = "",
) -> StatementLine:
    """Book an open line against a member (top-up or payout) or a category."""
    _require_treasurer(user)
    with db_transaction.atomic():
        line = _locked(line, LineState.OPEN)
        _check_currency(line)
        bank = get_system_account("asset:bank", line.book)
        legs, kind, category = _target_legs(
            line, bank, account=account, category=category
        )
        tx = _post(
            line,
            user=user,
            legs=legs,
            kind=kind,
            category=category,
            description=_description(line, description),
            key=f"statement_line:{line.pk}",
        )
        _learn_iban(line, account)
        line = _resolve(line, user, LineState.BOOKED, transaction=tx)
        notify_posting(tx, actor=user)
    return line


def link_line(line: StatementLine, tx: Transaction, *, user: User) -> StatementLine:
    """The money is already in the books: remember which entry it was."""
    _require_treasurer(user)
    with db_transaction.atomic():
        line = _locked(line, LineState.OPEN)
        if not link_candidates(line).filter(pk=tx.pk).exists():
            raise IntentError(
                _(
                    "That entry does not move this amount on the bank account "
                    "within ten days of the line, or another line already "
                    "accounts for it."
                ),
                field="transaction",
            )
        member = tx.entries.filter(account__type=AccountType.MEMBER).first()
        _learn_iban(line, member.account if member else None)
        return _resolve(line, user, LineState.LINKED, transaction=tx)


def park_line(line: StatementLine, *, user: User, note: str = "") -> StatementLine:
    """Put the money in suspense until someone knows what it was."""
    _require_treasurer(user)
    with db_transaction.atomic():
        line = _locked(line, LineState.OPEN)
        _check_currency(line)
        bank = get_system_account("asset:bank", line.book)
        suspense = get_system_account("suspense:unmatched", line.book)
        tx = _post(
            line,
            user=user,
            legs=[Leg(bank, line.amount), Leg(suspense, -line.amount)],
            kind=TransactionKind.ADJUSTMENT,
            category=None,
            description=gettext("Unclear bank line: %(text)s")
            % {"text": _description(line, "")[:400]},
            key=f"statement_line:{line.pk}",
        )
        return _resolve(line, user, LineState.SUSPENSE, transaction=tx, note=note)


def assign_line(
    line: StatementLine,
    *,
    user: User,
    account: Account | None = None,
    category: Category | None = None,
    description: str = "",
) -> StatementLine:
    """Move a parked line out of suspense to the member or category it was for."""
    _require_treasurer(user)
    with db_transaction.atomic():
        line = _locked(line, LineState.SUSPENSE)
        suspense = get_system_account("suspense:unmatched", line.book)
        legs, kind, category = _target_legs(
            line, suspense, account=account, category=category
        )
        tx = _post(
            line,
            user=user,
            legs=legs,
            kind=kind,
            category=category,
            description=_description(line, description),
            key=f"statement_line:{line.pk}:settle",
        )
        _learn_iban(line, account)
        line = _resolve(line, user, LineState.BOOKED, settlement=tx)
        notify_posting(tx, actor=user)
    return line


def ignore_line(line: StatementLine, *, user: User, note: str) -> StatementLine:
    """Leave the line out of the books, with a reason."""
    _require_treasurer(user)
    if not note.strip():
        raise IntentError(_("Say why this line is ignored."), field="note")
    with db_transaction.atomic():
        line = _locked(line, LineState.OPEN)
        return _resolve(line, user, LineState.IGNORED, note=note.strip())


def reopen_line(line: StatementLine, *, user: User) -> StatementLine:
    """Undo ignoring or linking. Booked and parked lines have entries in the
    ledger; those are reversed in the ledger, not here."""
    _require_treasurer(user)
    with db_transaction.atomic():
        line = _locked(line, LineState.IGNORED, LineState.LINKED)
        line.state = LineState.OPEN
        line.transaction = None
        line.resolved_by = None
        line.resolved_at = None
        line.save()
        _store_proposal(line)
    return line
