"""Tell members about ledger activity that concerns them (plan section 10).

Every notice goes out after the database transaction commits, so a rolled
back posting never announces anything. Each one is both an in-app message
(websocket) and a delivery on the channels the member enabled for the
"messages" group (email, Signal, push …), in the member's own language.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from django.db import transaction
from django.utils import translation

from bubble.core.websocket_signals import send_message_notification
from bubble.notifications.dispatch import dispatch_notification
from bubble.notifications.messages import format_notification
from bubble.notifications.models import EventType

if TYPE_CHECKING:
    from decimal import Decimal

    from bubble.ledger.models import Transaction
    from bubble.users.models import User

logger = logging.getLogger(__name__)


def money(amount: Decimal, currency: str, *, signed: bool = False) -> str:
    sign = "+" if signed and amount > 0 else ""
    return f"{sign}{amount:.2f} {currency}"


def display_name(user) -> str:
    return (user.name or user.username) if user else ""


def notify(user: User | None, kind: str, *, path: str = "/ledger", **params) -> None:
    """Queue one notice for ``user`` once the current transaction commits."""
    if user is None or not user.is_active:
        return
    context = {"kind": kind, "path": path, **{k: str(v) for k, v in params.items()}}

    def send() -> None:
        language = getattr(getattr(user, "profile", None), "language", "") or None
        with translation.override(language):
            _title, body = format_notification(EventType.LEDGER, context)
        try:
            send_message_notification(user.pk, message=body)
        except Exception:
            # The in-app message is best effort; the channels below still run.
            logger.exception("In-app ledger notice to %s failed", user.pk)
        dispatch_notification(user, EventType.LEDGER, context)

    transaction.on_commit(send)


def notify_posting(tx: Transaction, *, actor: User | None = None) -> None:
    """Tell every member whose balance a posting changes, except its actor."""
    actor_name = display_name(actor) if actor else "Bubble"
    for entry in tx.entries.select_related("account__owner"):
        owner = entry.account.owner
        if owner is None or (actor is not None and owner.pk == actor.pk):
            continue
        notify(
            owner,
            "posted",
            path=f"/ledger/t/{tx.pk}",
            actor=actor_name,
            description=tx.description,
            amount=money(
                entry.account.display(entry.amount.amount),
                str(entry.amount.currency),
                signed=True,
            ),
        )
