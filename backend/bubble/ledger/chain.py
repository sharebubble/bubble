"""The hash chains over all transactions and receipts (plan section 11).

Every posting is sealed right after it is written, inside the same database
transaction and under a per-book lock, so the chain order is the posting order:

    hash_n = sha256(hash_{n-1} || canonical(transaction_n))

with ``hash_0`` = 64 zeros. ``canonical`` is a JSON document with sorted keys
covering every stored field of the transaction and its entries, so changing
any amount, account, date or text anywhere breaks every later hash.

Receipts form a second chain of the same shape (they can be attached after
their transaction was sealed). A receipt's link covers its metadata and the
SHA-256 of its file; verification also re-hashes the stored file.

To verify independently, download the chain (``/api/ledger/chain/export/``),
recompute each hash from the transaction data and compare the last one with a
digest you kept.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import UTC
from typing import TYPE_CHECKING

from django.db import connection
from django.db.models import Q
from django.utils import timezone

from bubble.ledger.models import (
    LedgerDigest,
    Receipt,
    ReceiptSeal,
    Transaction,
    TransactionSeal,
)

if TYPE_CHECKING:
    from bubble.ledger.models import Book

logger = logging.getLogger(__name__)

GENESIS = "0" * 64
CHAIN_LOCK = 41_004  # first key of the two-key advisory lock (see services)
FORMAT_VERSION = 1


def _str(value) -> str | None:
    return None if value is None else str(value)


def canonical(tx: Transaction) -> bytes:
    """The exact bytes that are hashed for ``tx`` (format version 1)."""
    entries = sorted(tx.entries.all(), key=lambda e: str(e.pk))
    document = {
        "v": FORMAT_VERSION,
        "id": str(tx.pk),
        "book": str(tx.book_id),
        "seq": tx.seq,
        "kind": int(tx.kind),
        "occurred_on": tx.occurred_on.isoformat(),
        "created_at": tx.created_at.astimezone(UTC).isoformat(),
        "created_by": _str(tx.created_by_id),
        "description": tx.description,
        "category": _str(tx.category_id),
        "project": _str(tx.project_id),
        "source_type": tx.source_type,
        "source_id": tx.source_id,
        "idempotency_key": tx.idempotency_key,
        "reverses": _str(tx.reverses_id),
        "meta": tx.meta,
        "entries": [
            {
                "id": str(e.pk),
                "account": str(e.account_id),
                "amount": f"{e.amount.amount:.2f}",
                "currency": str(e.amount.currency),
                "item": _str(e.item_id),
                "memo": e.memo,
                "reverses_entry": _str(e.reverses_entry_id),
            }
            for e in entries
        ],
    }
    return json.dumps(
        document, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode()


def link_hash(prev_hash: str, tx: Transaction) -> str:
    return hashlib.sha256(prev_hash.encode() + canonical(tx)).hexdigest()


def lock_chain(book: Book) -> None:
    """Serialise sealing per book until the database transaction ends."""
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT pg_advisory_xact_lock(%s, hashtext(%s))",
            [CHAIN_LOCK, str(book.pk)],
        )


def head(book: Book) -> TransactionSeal | None:
    return TransactionSeal.objects.filter(book=book).order_by("-position").first()


def seal(tx: Transaction) -> TransactionSeal:
    """Append ``tx`` to its book's chain. The caller holds ``lock_chain``."""
    last = head(tx.book)
    prev_hash = last.hash if last else GENESIS
    return TransactionSeal.objects.create(
        transaction=tx,
        book_id=tx.book_id,
        position=(last.position + 1) if last else 1,
        prev_hash=prev_hash,
        hash=link_hash(prev_hash, tx),
    )


def canonical_receipt(receipt: Receipt) -> bytes:
    """The exact bytes that are hashed for ``receipt`` (format version 1)."""
    document = {
        "v": FORMAT_VERSION,
        "id": str(receipt.pk),
        "transaction": _str(receipt.transaction_id),
        "cost_share": _str(receipt.cost_share_id),
        "uploaded_by": _str(receipt.uploaded_by_id),
        "uploaded_at": receipt.uploaded_at.astimezone(UTC).isoformat(),
        "file_name": receipt.file_name,
        "content_type": receipt.content_type,
        "size": receipt.size,
        "sha256": receipt.sha256,
    }
    return json.dumps(
        document, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode()


def receipt_link_hash(prev_hash: str, receipt: Receipt) -> str:
    return hashlib.sha256(prev_hash.encode() + canonical_receipt(receipt)).hexdigest()


def receipt_head(book: Book) -> ReceiptSeal | None:
    return ReceiptSeal.objects.filter(book=book).order_by("-position").first()


def seal_receipt(receipt: Receipt) -> ReceiptSeal:
    """Append ``receipt`` to its book's receipt chain. The caller holds
    ``lock_chain`` for that book."""
    book_id = receipt.book_id
    last = ReceiptSeal.objects.filter(book_id=book_id).order_by("-position").first()
    prev_hash = last.hash if last else GENESIS
    return ReceiptSeal.objects.create(
        receipt=receipt,
        book_id=book_id,
        position=(last.position + 1) if last else 1,
        prev_hash=prev_hash,
        hash=receipt_link_hash(prev_hash, receipt),
    )


@dataclass
class ChainCheck:
    length: int
    head_hash: str
    broken_at: int | None = None  # first position whose hash does not match
    unsealed: int = 0  # transactions without a seal
    receipt_length: int = 0
    receipt_head_hash: str = GENESIS
    receipt_broken_at: int | None = None  # bad link, or a file that changed
    unsealed_receipts: int = 0

    @property
    def ok(self) -> bool:
        return (
            self.broken_at is None
            and self.unsealed == 0
            and self.receipt_broken_at is None
            and self.unsealed_receipts == 0
        )


def verify_chain(book: Book) -> ChainCheck:
    """Recompute every hash from the stored rows, in chain order."""
    prev = GENESIS
    length = 0
    seals = (
        TransactionSeal.objects.filter(book=book)
        .select_related("transaction")
        .prefetch_related("transaction__entries")
        .order_by("position")
    )
    for link in seals.iterator(chunk_size=500):
        length += 1
        if (
            link.position != length
            or link.prev_hash != prev
            or link.hash != link_hash(prev, link.transaction)
        ):
            return _with_receipts(
                book, ChainCheck(length=length, head_hash=prev, broken_at=length)
            )
        prev = link.hash
    unsealed = Transaction.objects.filter(book=book, seal__isnull=True).count()
    return _with_receipts(
        book, ChainCheck(length=length, head_hash=prev, unsealed=unsealed)
    )


def _with_receipts(book: Book, check: ChainCheck) -> ChainCheck:
    """Add the receipt chain's result: every link, and every stored file
    against the SHA-256 its link covers."""
    prev = GENESIS
    length = 0
    seals = (
        ReceiptSeal.objects.filter(book=book)
        .select_related("receipt")
        .order_by("position")
    )
    # Small chunks: each row carries a whole file.
    for link in seals.iterator(chunk_size=20):
        length += 1
        receipt = link.receipt
        if (
            link.position != length
            or link.prev_hash != prev
            or link.hash != receipt_link_hash(prev, receipt)
            or hashlib.sha256(bytes(receipt.content)).hexdigest() != receipt.sha256
        ):
            check.receipt_broken_at = length
            break
        prev = link.hash
    check.receipt_length = length
    check.receipt_head_hash = prev
    check.unsealed_receipts = (
        Receipt.objects.filter(seal__isnull=True)
        .filter(Q(transaction__book=book) | Q(cost_share__book=book))
        .count()
    )
    return check


def publish_digest(book: Book) -> LedgerDigest:
    """Verify the whole chain and record (and publish) its head.

    The message goes to ``LEDGER_DIGEST_APPRISE_URL``, so the heads live
    outside the app where nobody with database access can rewrite them. The
    channel is required: without it (or when sending fails) the digest is
    stored as unpublished, an error is logged and the ledger's health check
    fails. A broken chain is published too: silence would hide it.
    """
    from constance import config  # noqa: PLC0415

    from bubble.notifications.providers.apprise_provider import (  # noqa: PLC0415
        send_apprise_notification,
    )

    check = verify_chain(book)
    today = timezone.localdate().isoformat()
    if check.ok:
        title = f"Bubble ledger digest {today}"
        body = (
            f"{check.length} transactions and {check.receipt_length} receipts, "
            "both chains verified.\n"
            f"Transactions head #{check.length}: {check.head_hash}\n"
            f"Receipts head #{check.receipt_length}: {check.receipt_head_hash}"
        )
    else:
        title = f"Bubble ledger digest {today}: CHAIN BROKEN"
        body = (
            "The chains do not verify.\n"
            f"Transactions: first bad position {check.broken_at}, "
            f"{check.unsealed} unsealed, last good head {check.head_hash}\n"
            f"Receipts: first bad position {check.receipt_broken_at}, "
            f"{check.unsealed_receipts} unsealed, last good head "
            f"{check.receipt_head_hash}"
        )
        logger.error("Ledger chain verification FAILED: %s", check)
    published = False
    url = config.LEDGER_DIGEST_APPRISE_URL
    if url:
        try:
            published = send_apprise_notification(url, title, body)
        except Exception:
            logger.exception("Publishing the ledger digest failed")
        if not published:
            logger.error("The ledger digest could not be published to its channel.")
    else:
        # The channel is required: a head that only lives in this database
        # protects against nobody who can write to it.
        logger.error(
            "LEDGER_DIGEST_APPRISE_URL is not set: the ledger digest was NOT "
            "published. Set it in the admin (Constance)."
        )
    return LedgerDigest.objects.create(
        book=book,
        position=check.length,
        head_hash=check.head_hash,
        transaction_count=check.length,
        receipt_position=check.receipt_length,
        receipt_head_hash=check.receipt_head_hash,
        chain_ok=check.ok,
        published=published,
    )
