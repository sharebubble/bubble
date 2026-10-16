"""Proposes who a bank line belongs to (plan section 12).

In order of trust: the member's payment reference in the transfer text (high),
an IBAN the member paid from before (medium), a similar name (low). Separately,
an entry someone already posted by hand for the same bank movement is proposed
for linking, so it is not booked twice. Proposals are only suggestions; the
treasurer confirms each line (or, if enabled, high-confidence top-ups are
booked straight away).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import timedelta
from difflib import SequenceMatcher
from typing import TYPE_CHECKING

from django.db.models import Exists, OuterRef
from django.utils.translation import gettext as _

from bubble.ledger.models import (
    Account,
    AccountType,
    Entry,
    KnownIban,
    MatchConfidence,
    StatementLine,
    Transaction,
    TransactionKind,
)
from bubble.ledger.services import REFERENCE_PREFIX, get_system_account

if TYPE_CHECKING:
    from bubble.ledger.models import Book

REFERENCE = re.compile(rf"{REFERENCE_PREFIX}-?([2-9A-HJKMNP-Z]{{6}})")
NAME_THRESHOLD = 0.85
LINK_WINDOW = timedelta(days=10)


@dataclass
class Proposal:
    account: Account | None = None
    transaction: Transaction | None = None
    confidence: str = MatchConfidence.NONE
    reason: str = ""


def _members(book: Book):
    return Account.objects.filter(book=book, type=AccountType.MEMBER, is_active=True)


def by_reference(book: Book, text: str) -> Account | None:
    # Online banking often wraps long texts, splitting a reference in two.
    squashed = "".join(text.upper().split())
    for code in REFERENCE.findall(squashed):
        account = _members(book).filter(payment_reference=f"{REFERENCE_PREFIX}-{code}")
        if found := account.first():
            return found
    return None


def _normal_name(name: str) -> str:
    ascii_name = (
        unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    )
    # "Mustermann, Max" and "MAX MUSTERMANN" compare equal.
    return " ".join(sorted(re.findall(r"[a-z]+", ascii_name)))


def by_name(book: Book, name: str) -> Account | None:
    wanted = _normal_name(name)
    if len(wanted) < 4:  # noqa: PLR2004
        return None
    scored = sorted(
        (
            (SequenceMatcher(None, wanted, _normal_name(account.name)).ratio(), account)
            for account in _members(book).select_related("owner")
        ),
        key=lambda pair: -pair[0],
    )
    if not scored or scored[0][0] < NAME_THRESHOLD:
        return None
    # Two members with near-identical names: no guess.
    if len(scored) > 1 and scored[1][0] >= NAME_THRESHOLD:
        return None
    return scored[0][1]


def link_candidates(line: StatementLine):
    """Entries on the bank account with this line's amount, near its date, that
    no other line accounts for yet."""
    bank = get_system_account("asset:bank", line.book)
    already = StatementLine.objects.filter(transaction=OuterRef("pk")).exclude(
        pk=line.pk
    )
    return (
        Transaction.objects.filter(
            book=line.book,
            entries__account=bank,
            entries__amount=line.amount,
            occurred_on__gte=line.booked_on - LINK_WINDOW,
            occurred_on__lte=line.booked_on + LINK_WINDOW,
        )
        .exclude(kind__in=[TransactionKind.REVERSAL, TransactionKind.CORRECTION])
        .exclude(Exists(Transaction.objects.filter(reverses=OuterRef("pk"))))
        .exclude(Exists(already))
        .distinct()
        .order_by("occurred_on", "seq")
    )


def _member_of(tx: Transaction) -> Account | None:
    entry = (
        Entry.objects.filter(transaction=tx, account__type=AccountType.MEMBER)
        .select_related("account")
        .first()
    )
    return entry.account if entry else None


def propose(line: StatementLine) -> Proposal:
    book = line.book
    proposal = Proposal()
    if account := by_reference(book, line.reference):
        proposal = Proposal(
            account, None, MatchConfidence.HIGH, _("Payment reference in the text")
        )
    elif line.counterparty_iban and (
        known := KnownIban.objects.filter(
            book=book, iban=line.counterparty_iban, account__is_active=True
        )
        .select_related("account")
        .first()
    ):
        proposal = Proposal(
            known.account, None, MatchConfidence.MEDIUM, _("Paid from this IBAN before")
        )
    elif line.counterparty_name and (account := by_name(book, line.counterparty_name)):
        proposal = Proposal(account, None, MatchConfidence.LOW, _("Similar name"))

    if line.currency != book.currency:
        return proposal
    candidates = list(link_candidates(line)[:10])
    if proposal.account is not None:
        # Prefer the member's own hand-posted top-up or payout.
        mine = [tx for tx in candidates if _member_of(tx) == proposal.account]
        if mine:
            proposal.transaction = mine[0]
            proposal.reason = _("%(reason)s; already posted as #%(seq)d") % {
                "reason": proposal.reason,
                "seq": mine[0].seq,
            }
    elif len(candidates) == 1:
        tx = candidates[0]
        proposal = Proposal(
            _member_of(tx),
            tx,
            MatchConfidence.LOW,
            _("Same amount as #%(seq)d from %(date)s")
            % {"seq": tx.seq, "date": tx.occurred_on.isoformat()},
        )
    return proposal
