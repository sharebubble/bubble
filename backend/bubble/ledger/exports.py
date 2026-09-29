"""Bookkeeping exports and period close (plan section 13, D12, phase 6).

Two exports of the same entries:

* the **journal** (CSV, UTF-8): one row per entry with stable identifiers
  only (codes, not display names), so the same period always produces the
  same bytes. Its SHA-256 is stored when a period is closed.
* the **DATEV Buchungsstapel** (EXTF, Windows-1252): for the tax advisor.
  Every ledger account needs a DATEV account number (``Account.datev_number``;
  member accounts may share ``DATEV_MEMBER_ACCOUNT``). A transaction with more
  than two legs becomes one DATEV booking per leg against its largest leg,
  which keeps every booking two-sided and the sum unchanged.

Closing a period (treasurer) records the export hash and the chain head;
afterwards nothing can be posted with a date inside it (invariant I6) —
mistakes are corrected in the open period.
"""

from __future__ import annotations

import csv
import hashlib
import io
from dataclasses import dataclass
from datetime import date
from typing import TYPE_CHECKING

from constance import config
from django.db import transaction as db_transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from bubble.ledger.chain import head, lock_chain
from bubble.ledger.intents import IntentError
from bubble.ledger.models import (
    Account,
    AccountType,
    Book,
    CostShare,
    CostShareState,
    Entry,
    LedgerPeriod,
    Transaction,
    TransactionKind,
)

if TYPE_CHECKING:
    from decimal import Decimal

    from bubble.users.models import User

JOURNAL_HEADER = [
    "date",
    "seq",
    "transaction",
    "kind",
    "description",
    "category",
    "project",
    "account",
    "account_name",
    "debit",
    "credit",
    "currency",
    "memo",
    "reverses",
]


def _entries(book: Book, date_from: date, date_to: date):
    return (
        Entry.objects.filter(
            transaction__book=book,
            transaction__occurred_on__gte=date_from,
            transaction__occurred_on__lte=date_to,
        )
        .select_related("account", "transaction__category", "transaction__project")
        .order_by("transaction__occurred_on", "transaction__seq", "id")
    )


def journal_csv(book: Book, date_from: date, date_to: date) -> bytes:
    """Every entry of the period, deterministic for the same period."""
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(JOURNAL_HEADER)
    for entry in _entries(book, date_from, date_to):
        tx = entry.transaction
        amount = entry.amount.amount
        writer.writerow(
            [
                tx.occurred_on.isoformat(),
                tx.seq,
                tx.pk,
                TransactionKind(tx.kind).name.lower(),
                tx.description,
                tx.category.code if tx.category else "",
                tx.project.slug if tx.project else "",
                entry.account.code,
                entry.account.name,
                f"{amount:.2f}" if amount > 0 else "",
                f"{-amount:.2f}" if amount < 0 else "",
                str(entry.amount.currency),
                entry.memo,
                tx.reverses_id or "",
            ]
        )
    return out.getvalue().encode()


# --- DATEV ------------------------------------------------------------------


class DatevMappingError(IntentError):
    """Some accounts of the period have no DATEV account number."""

    def __init__(self, accounts: list[Account]):
        self.accounts = accounts
        names = [a.code for a in accounts if a.type != AccountType.MEMBER][:10]
        if any(a.type == AccountType.MEMBER for a in accounts):
            names.append(str(_("member accounts (setting DATEV_MEMBER_ACCOUNT)")))
        names = ", ".join(names)
        super().__init__(
            _("These accounts need a DATEV account number first: %(names)s")
            % {"names": names},
            field="datev_number",
        )


def datev_number(account: Account) -> str:
    if account.datev_number:
        return account.datev_number
    if account.type == AccountType.MEMBER:
        return config.DATEV_MEMBER_ACCOUNT or ""
    return ""


@dataclass
class DatevBooking:
    amount: Decimal  # positive
    debit: bool  # Soll for "Konto"
    account: str
    counter: str
    day: date
    reference: str
    text: str


def datev_bookings(book: Book, date_from: date, date_to: date) -> list[DatevBooking]:
    """Two-sided DATEV bookings for every transaction of the period."""
    transactions = (
        Transaction.objects.filter(
            book=book, occurred_on__gte=date_from, occurred_on__lte=date_to
        )
        .prefetch_related("entries__account")
        .order_by("occurred_on", "seq")
    )
    missing: dict[str, Account] = {}
    bookings: list[DatevBooking] = []
    for tx in transactions:
        # The largest leg is the counter account; on a tie the credit leg,
        # so a plain expense reads "debit expense, credit member".
        entries = sorted(
            tx.entries.all(),
            key=lambda e: (-abs(e.amount.amount), e.amount.amount > 0, str(e.pk)),
        )
        for entry in entries:
            if not datev_number(entry.account):
                missing[entry.account.code] = entry.account
        main, others = entries[0], entries[1:]
        for entry in others:
            amount = entry.amount.amount
            bookings.append(
                DatevBooking(
                    amount=abs(amount),
                    debit=amount > 0,
                    account=datev_number(entry.account),
                    counter=datev_number(main.account),
                    day=tx.occurred_on,
                    reference=str(tx.seq),
                    text=(entry.memo or tx.description)[:60],
                )
            )
    if missing:
        raise DatevMappingError(sorted(missing.values(), key=lambda a: a.code))
    return bookings


def _q(value: str) -> str:
    """A DATEV text field: quoted, inner quotes doubled, no line breaks."""
    return '"' + value.replace('"', '""').replace("\r", " ").replace("\n", " ") + '"'


def datev_csv(book: Book, date_from: date, date_to: date) -> bytes:
    """DATEV Buchungsstapel (EXTF 700, category 21, format version 13).

    Only the leading columns up to "Buchungstext" are filled; have the tax
    advisor import a first file as a test before relying on it.
    """
    bookings = datev_bookings(book, date_from, date_to)
    now = timezone.localtime()
    fiscal_start = date(date_from.year, 1, 1)
    header = [
        _q("EXTF"),
        "700",
        "21",
        _q("Buchungsstapel"),
        "13",
        now.strftime("%Y%m%d%H%M%S") + f"{now.microsecond // 1000:03d}",
        "",
        _q("RE"),
        _q("bubble"),
        _q(""),
        str(config.DATEV_CONSULTANT_NUMBER or ""),
        str(config.DATEV_CLIENT_NUMBER or ""),
        fiscal_start.strftime("%Y%m%d"),
        str(config.DATEV_ACCOUNT_LENGTH),
        date_from.strftime("%Y%m%d"),
        date_to.strftime("%Y%m%d"),
        _q(f"Bubble {date_from:%Y-%m-%d} - {date_to:%Y-%m-%d}"),
        _q(""),
        "1",
        "0",
        "0",
        _q(book.currency),
        "",
        _q(""),
        "",
        "",
        _q(""),
        "",
        "",
        _q(""),
        _q(""),
    ]
    columns = [
        "Umsatz (ohne Soll/Haben-Kz)",
        "Soll/Haben-Kennzeichen",
        "WKZ Umsatz",
        "Kurs",
        "Basis-Umsatz",
        "WKZ Basis-Umsatz",
        "Konto",
        "Gegenkonto (ohne BU-Schlüssel)",
        "BU-Schlüssel",
        "Belegdatum",
        "Belegfeld 1",
        "Belegfeld 2",
        "Skonto",
        "Buchungstext",
    ]
    lines = [";".join(header), ";".join(_q(c) for c in columns)]
    lines.extend(
        ";".join(
            [
                f"{b.amount:.2f}".replace(".", ","),
                _q("S" if b.debit else "H"),
                _q(book.currency),
                "",
                "",
                _q(""),
                b.account,
                b.counter,
                _q(""),
                b.day.strftime("%d%m"),
                _q(b.reference),
                _q(""),
                "",
                _q(b.text),
            ]
        )
        for b in bookings
    )
    return ("\r\n".join(lines) + "\r\n").encode("cp1252", errors="replace")


# --- Period close -------------------------------------------------------------


def close_period(
    book: Book, starts_on: date, ends_on: date, *, user: User
) -> LedgerPeriod:
    """Close ``starts_on`` to ``ends_on``: record the journal's hash and the chain
    head; afterwards postings dated inside it are refused (I6)."""
    if starts_on > ends_on:
        raise IntentError(_("The end date is before the start date."), field="ends_on")
    if ends_on >= timezone.localdate():
        raise IntentError(
            _("Only periods that have already ended can be closed."), field="ends_on"
        )
    overlapping = LedgerPeriod.objects.filter(
        book=book, starts_on__lte=ends_on, ends_on__gte=starts_on
    )
    if overlapping.exists():
        raise IntentError(
            _("This period overlaps one that is already closed."), field="starts_on"
        )
    open_splits = CostShare.objects.filter(
        book=book,
        state=CostShareState.OPEN,
        occurred_on__gte=starts_on,
        occurred_on__lte=ends_on,
    ).count()
    if open_splits:
        raise IntentError(
            _(
                "%(count)d shared cost(s) dated in this period are still waiting "
                "for answers. Close the period once they are booked."
            )
            % {"count": open_splits}
        )
    with db_transaction.atomic():
        # Holding the chain lock: no posting can land in the period meanwhile.
        lock_chain(book)
        journal = journal_csv(book, starts_on, ends_on)
        current = head(book)
        return LedgerPeriod.objects.create(
            book=book,
            starts_on=starts_on,
            ends_on=ends_on,
            closed_at=timezone.now(),
            closed_by=user,
            export_hash=hashlib.sha256(journal).hexdigest(),
            chain_position=current.position if current else 0,
            chain_head=current.hash if current else "",
            transaction_count=Transaction.objects.filter(
                Q(book=book) & Q(occurred_on__gte=starts_on, occurred_on__lte=ends_on)
            ).count(),
        )
