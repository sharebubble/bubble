"""Balance reminders (plan D10): nothing is blocked, members are reminded."""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from bubble.ledger.models import Account, AccountType, Book
from bubble.ledger.notify import money, notify

SOFT_LIMIT_REMINDER_EVERY = timedelta(days=7)


def remind_low_balances(now=None) -> int:
    """Remind members below the soft limit, at most once a week each.

    Returns how many reminders were sent. A member whose balance recovered
    is forgotten, so dropping below again reminds them straight away.
    """
    now = now or timezone.now()
    book = Book.objects.default()
    limit = book.negative_balance_soft_limit
    sent = 0
    members = Account.objects.filter(
        book=book, type=AccountType.MEMBER, is_active=True
    ).select_related("balance", "owner")
    for account in members:
        raw = account.balance.balance if hasattr(account, "balance") else 0
        display = account.display(raw)
        if display >= limit:
            if account.soft_limit_reminded_at is not None:
                account.soft_limit_reminded_at = None
                account.save(update_fields=["soft_limit_reminded_at"])
            continue
        last = account.soft_limit_reminded_at
        if last is not None and now - last < SOFT_LIMIT_REMINDER_EVERY:
            continue
        notify(
            account.owner,
            "soft_limit",
            path="/ledger/me",
            amount=money(display, book.currency),
            limit=money(limit, book.currency),
        )
        account.soft_limit_reminded_at = now
        account.save(update_fields=["soft_limit_reminded_at"])
        sent += 1
    return sent
