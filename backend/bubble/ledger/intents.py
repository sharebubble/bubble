"""Manual postings, expressed as intents (plan section 7).

Members never send raw entry lists. They say what happened, "I paid 50 € for a
drill", and this module expands it into balanced legs. Direct posts may only
charge the poster's own member account (D2); charging someone else is a shared
expense and waits for their confirmation (section 7a, phase 4).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING

from django.db import transaction as db_transaction
from django.db.models import TextChoices
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from bubble.ledger.exceptions import LedgerError
from bubble.ledger.models import (
    RECEIPT_MAX_BYTES,
    Account,
    AccountType,
    Book,
    Category,
    CategoryKind,
    Receipt,
    Transaction,
    TransactionKind,
)
from bubble.ledger.notify import notify_posting
from bubble.ledger.rounding import CENT
from bubble.ledger.services import (
    Leg,
    get_member_account,
    get_system_account,
    post_transaction,
)

if TYPE_CHECKING:
    from datetime import date

    from django.core.files.uploadedfile import UploadedFile

    from bubble.ledger.models import Project
    from bubble.users.models import User

LEDGER_ADMIN_GROUP = "ledger_admin"
MAX_AMOUNT = Decimal("100000.00")
MAX_RECEIPTS = 5


class IntentError(LedgerError):
    """The request cannot be turned into a posting; the message is user-facing."""

    def __init__(self, message, field: str | None = None):
        super().__init__(message)
        # Kept apart from the exception's own text so the API returns exactly
        # this translated sentence, never anything derived from the exception.
        self.user_message = message
        self.field = field


class IntentForbiddenError(IntentError):
    """The member is not allowed to do this (as opposed to a malformed request)."""


class Intent(TextChoices):
    EXPENSE_FOR_COMMUNITY = "expense_for_community", _("I paid for the community")
    TOP_UP = "top_up", _("I paid money in")
    MEMBER_TO_MEMBER = "member_to_member", _("I owe another member")
    PAYOUT = "payout", _("Pay a member out")
    INCOME = "income", _("Community income")


class Via(TextChoices):
    BANK = "bank", _("Bank transfer")
    CASH = "cash", _("Cash")


ADMIN_INTENTS = {Intent.PAYOUT, Intent.INCOME}

# Categories that some intents always use; members do not pick them.
FIXED_CATEGORY = {
    Intent.TOP_UP: "top-up",
    Intent.MEMBER_TO_MEMBER: "member-transfer",
    Intent.PAYOUT: "payout",
}
# Intents where the member picks the category, and the kind it must have.
CHOSEN_CATEGORY_KIND = {
    Intent.EXPENSE_FOR_COMMUNITY: CategoryKind.EXPENSE,
    Intent.INCOME: CategoryKind.INCOME,
}
KIND = {
    Intent.EXPENSE_FOR_COMMUNITY: TransactionKind.MEMBER_EXPENSE,
    Intent.TOP_UP: TransactionKind.TOP_UP,
    Intent.MEMBER_TO_MEMBER: TransactionKind.MEMBER_TRANSFER,
    Intent.PAYOUT: TransactionKind.PAYOUT,
    Intent.INCOME: TransactionKind.INCOME,
}


def is_ledger_admin(user: User) -> bool:
    """The treasurer role: payouts, community income, reversing anything."""
    return user.is_superuser or user.groups.filter(name=LEDGER_ADMIN_GROUP).exists()


@dataclass(frozen=True)
class ManualPosting:
    intent: Intent
    amount: Decimal
    occurred_on: date
    description: str
    category: Category | None = None
    project: Project | None = None
    counterparty: Account | None = None
    via: Via = Via.BANK
    client_key: str = ""


def _category(posting: ManualPosting, book: Book) -> Category:
    fixed = FIXED_CATEGORY.get(posting.intent)
    if fixed:
        return Category.objects.get(book=book, code=fixed)
    category = posting.category
    expected = CHOSEN_CATEGORY_KIND[posting.intent]
    if category is None:
        raise IntentError(_("Pick a category."), field="category")
    if (
        category.book_id != book.pk
        or category.kind != expected
        or category.account_id is None
        or not category.is_active
    ):
        raise IntentError(
            _("This category cannot be used for this kind of entry."),
            field="category",
        )
    return category


def _counterparty(posting: ManualPosting, me: Account, book: Book) -> Account:
    other = posting.counterparty
    if other is None:
        raise IntentError(_("Pick a member."), field="counterparty")
    if (
        other.book_id != book.pk
        or other.type != AccountType.MEMBER
        or not other.is_active
    ):
        raise IntentError(_("Pick an active member."), field="counterparty")
    if other.pk == me.pk and posting.intent == Intent.MEMBER_TO_MEMBER:
        raise IntentError(_("You cannot owe yourself."), field="counterparty")
    return other


def _legs(
    posting: ManualPosting, me: Account, category: Category, book: Book
) -> list[Leg]:
    x = posting.amount
    asset = get_system_account(f"asset:{posting.via}", book)
    match posting.intent:
        case Intent.EXPENSE_FOR_COMMUNITY:
            # The community spent money through me: it owes me that much more.
            return [Leg(category.account, x), Leg(me, -x)]
        case Intent.TOP_UP:
            # My money reached the community's bank or cash box.
            return [Leg(asset, x), Leg(me, -x)]
        case Intent.MEMBER_TO_MEMBER:
            # I owe them: my account is charged, theirs credited.
            other = _counterparty(posting, me, book)
            return [Leg(me, x), Leg(other, -x)]
        case Intent.PAYOUT:
            other = _counterparty(posting, me, book)
            return [Leg(other, x), Leg(asset, -x)]
        case Intent.INCOME:
            return [Leg(asset, x), Leg(category.account, -x)]
    msg = f"Unknown intent {posting.intent}"
    raise IntentError(msg)


def _check(posting: ManualPosting, user: User) -> None:
    if posting.intent in ADMIN_INTENTS and not is_ledger_admin(user):
        raise IntentForbiddenError(
            _("Only the treasurer can post this kind of entry."), field="intent"
        )
    amount = posting.amount
    if amount <= 0:
        raise IntentError(_("The amount must be positive."), field="amount")
    if amount != amount.quantize(CENT):
        raise IntentError(_("Use at most two decimal places."), field="amount")
    if amount > MAX_AMOUNT:
        raise IntentError(_("This amount is too large."), field="amount")
    if posting.occurred_on > timezone.localdate():
        raise IntentError(_("The date cannot be in the future."), field="occurred_on")
    if not posting.description.strip():
        raise IntentError(_("Describe what this is for."), field="description")


def post_intent(
    posting: ManualPosting,
    *,
    user: User,
    receipts: list[UploadedFile] = (),
    book: Book | None = None,
) -> Transaction:
    """Validate an intent, post it, and attach its receipts, all or nothing."""
    book = book or Book.objects.default()
    _check(posting, user)
    if len(receipts) > MAX_RECEIPTS:
        raise IntentError(
            _("Attach at most %(count)d receipts.") % {"count": MAX_RECEIPTS},
            field="receipts",
        )
    receipt_data = [read_receipt(f) for f in receipts]

    me = get_member_account(user, book)
    category = _category(posting, book)
    if posting.project is not None and (
        posting.project.book_id != book.pk or posting.project.is_archived
    ):
        raise IntentError(_("This project is closed."), field="project")
    legs = _legs(posting, me, category, book)

    # A client-generated key per form makes double submits post once. It is
    # scoped to the author, so nobody can collide with another member's key.
    key = f"manual:{me.pk}:{posting.client_key}" if posting.client_key else None
    if key:
        replayed = Transaction.objects.filter(book=book, idempotency_key=key).first()
        if replayed is not None:
            return replayed
    with db_transaction.atomic():
        tx = post_transaction(
            book=book,
            kind=KIND[posting.intent],
            occurred_on=posting.occurred_on,
            description=posting.description.strip(),
            legs=legs,
            created_by=me,
            category=category,
            project=posting.project,
            idempotency_key=key,
            meta={"intent": str(posting.intent)},
        )
        if not tx.receipts.exists():
            for data in receipt_data:
                store_receipt(tx, me, data)
        notify_posting(tx, actor=user)
    return tx


@dataclass(frozen=True)
class ReceiptData:
    file_name: str
    content_type: str
    content: bytes


# Content types are sniffed from the bytes, never taken from the client.
_SIGNATURES = [
    (b"%PDF-", "application/pdf"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
]
_HEIF_BRANDS = {b"heic", b"heix", b"heim", b"heis", b"mif1", b"msf1"}


def sniff_content_type(head: bytes) -> str | None:
    for signature, content_type in _SIGNATURES:
        if head.startswith(signature):
            return content_type
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[4:8] == b"ftyp" and head[8:12] in _HEIF_BRANDS:
        return "image/heic"
    return None


def read_receipt(upload: UploadedFile) -> ReceiptData:
    if upload.size > RECEIPT_MAX_BYTES:
        raise IntentError(
            _("A receipt can be at most %(mb)d MB.")
            % {"mb": RECEIPT_MAX_BYTES // (1024 * 1024)},
            field="receipts",
        )
    content = upload.read()
    content_type = sniff_content_type(content[:16])
    if content_type is None:
        raise IntentError(
            _("Receipts must be PDF, JPEG, PNG, WebP or HEIC files."),
            field="receipts",
        )
    name = (upload.name or "receipt").rsplit("/", 1)[-1][:255]
    return ReceiptData(file_name=name, content_type=content_type, content=content)


def store_receipt(
    tx: Transaction | None,
    uploader: Account,
    data: ReceiptData,
    *,
    cost_share=None,
) -> Receipt:
    """Keep a receipt for a transaction, or for a shared expense before it posts."""
    return Receipt.objects.create(
        transaction=tx,
        cost_share=cost_share,
        uploaded_by=uploader,
        file_name=data.file_name,
        content_type=data.content_type,
        size=len(data.content),
        sha256=hashlib.sha256(data.content).hexdigest(),
        content=data.content,
    )


def can_add_receipt(tx: Transaction, user: User) -> bool:
    """The author (or the treasurer) may add receipts later; nobody removes one."""
    if is_ledger_admin(user):
        return True
    return tx.created_by_id is not None and tx.created_by.owner_id == user.pk


def add_receipt(tx: Transaction, upload: UploadedFile, *, user: User) -> Receipt:
    if not can_add_receipt(tx, user):
        raise IntentForbiddenError(
            _("Only the author can add receipts to this transaction."),
            field="receipts",
        )
    if tx.receipts.count() >= MAX_RECEIPTS:
        raise IntentError(
            _("Attach at most %(count)d receipts.") % {"count": MAX_RECEIPTS},
            field="receipts",
        )
    return store_receipt(tx, get_member_account(user, tx.book), read_receipt(upload))
