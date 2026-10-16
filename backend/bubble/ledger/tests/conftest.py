import pytest

from bubble.ledger.models import Book, TransactionKind
from bubble.ledger.services import (
    Leg,
    get_member_account,
    get_system_account,
    post_transaction,
)
from bubble.ledger.tests.helpers import TODAY, eur
from bubble.users.tests.factories import UserFactory


@pytest.fixture
def book(db) -> Book:
    return Book.objects.default()


@pytest.fixture
def members(book):
    """Four members with open accounts: alice, bob, carla, dan."""
    users = {
        name: UserFactory(username=name, name=name.title())
        for name in ["alice", "bob", "carla", "dan"]
    }
    return {name: get_member_account(user) for name, user in users.items()}


@pytest.fixture
def post(book):
    """Post a transaction from ``(account, amount)`` pairs."""

    def _post(*pairs, kind=TransactionKind.ADJUSTMENT, **kwargs):
        kwargs.setdefault("occurred_on", TODAY)
        kwargs.setdefault("description", "test posting")
        legs = [
            Leg(
                account=get_system_account(a) if isinstance(a, str) else a,
                amount=eur(x),
            )
            for a, x in pairs
        ]
        return post_transaction(kind=kind, legs=legs, **kwargs)

    return _post


@pytest.fixture
def notices(monkeypatch):
    """Record ledger notices instead of sending them: ``[(user, context)]``.

    Notices go out on commit; run the code under
    ``django_capture_on_commit_callbacks(execute=True)`` to see them.
    """
    sent = []
    monkeypatch.setattr(
        "bubble.ledger.notify.dispatch_notification",
        lambda user, event_type, context: sent.append((user, context)),
    )
    monkeypatch.setattr(
        "bubble.ledger.notify.send_message_notification",
        lambda user_id, message: None,
    )
    return sent
