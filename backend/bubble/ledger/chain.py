"""The hash chain over all transactions (plan section 11, phase 6).

Every posting is sealed right after it is written, inside the same database
transaction and under a per-book lock, so the chain order is the posting order:

    hash_n = sha256(hash_{n-1} || canonical(transaction_n))

with ``hash_0`` = 64 zeros. ``canonical`` is a JSON document with sorted keys
covering every stored field of the transaction and its entries, so changing
any amount, account, date or text anywhere breaks every later hash.

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
from django.utils import timezone

from bubble.ledger.models import LedgerDigest, Transaction, TransactionSeal

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


@dataclass
class ChainCheck:
    length: int
    head_hash: str
    broken_at: int | None = None  # first position whose hash does not match
    unsealed: int = 0  # transactions without a seal

    @property
    def ok(self) -> bool:
        return self.broken_at is None and self.unsealed == 0


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
            return ChainCheck(length=length, head_hash=prev, broken_at=length)
        prev = link.hash
    unsealed = Transaction.objects.filter(book=book, seal__isnull=True).count()
    return ChainCheck(length=length, head_hash=prev, unsealed=unsealed)


def publish_digest(book: Book) -> LedgerDigest:
    """Verify the whole chain and record (and publish) its head.

    The message goes to ``LEDGER_DIGEST_APPRISE_URL`` when configured, so the
    head hash lives outside the app where nobody with database access can
    rewrite it. A broken chain is published too: silence would hide it.
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
            f"{check.length} transactions, chain verified.\n"
            f"Head #{check.length}: {check.head_hash}"
        )
    else:
        title = f"Bubble ledger digest {today}: CHAIN BROKEN"
        body = (
            f"The chain does not verify (first bad position: {check.broken_at}, "
            f"unsealed transactions: {check.unsealed}). Last good head: "
            f"{check.head_hash}"
        )
        logger.error("Ledger chain verification FAILED: %s", check)
    published = False
    url = config.LEDGER_DIGEST_APPRISE_URL
    if url:
        try:
            published = send_apprise_notification(url, title, body)
        except Exception:
            logger.exception("Publishing the ledger digest failed")
    return LedgerDigest.objects.create(
        book=book,
        position=check.length,
        head_hash=check.head_hash,
        transaction_count=check.length,
        chain_ok=check.ok,
        published=published,
    )
