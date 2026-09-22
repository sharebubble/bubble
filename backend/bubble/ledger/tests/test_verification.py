"""verify_ledger (I7, I8), randomised posting sequences, and concurrency."""

import random
import threading
from decimal import Decimal

import pytest
from django.db import connection, connections

from bubble.ledger.models import AccountBalance, Book, Transaction, TransactionKind
from bubble.ledger.rounding import allocate
from bubble.ledger.services import (
    Leg,
    get_system_account,
    post_transaction,
    reverse_transaction,
    verify_ledger,
)
from bubble.ledger.tasks import verify_ledger_nightly
from bubble.ledger.tests.helpers import TODAY, eur


def test_empty_ledger_verifies(book):
    assert verify_ledger().ok


def test_tampered_cache_is_detected(members, post, caplog):
    post((members["bob"], "10"), ("income:rental", "-10"))
    AccountBalance.objects.filter(account=members["bob"]).update(balance=Decimal("99"))

    result = verify_ledger()

    assert not result.ok
    assert result.mismatched_accounts == [
        (members["bob"].code, Decimal("99.00"), Decimal("10.00"))
    ]
    verify_ledger_nightly.call_local()
    assert "Ledger verification FAILED" in caplog.text


@pytest.mark.parametrize("seed", range(20))
def test_random_postings_and_reversals_keep_every_invariant(members, seed):
    """Property test: whatever happens, the books add up and the cache is right."""
    rng = random.Random(seed)  # noqa: S311
    accounts = [
        *members.values(),
        *(
            get_system_account(c)
            for c in ["asset:bank", "income:rental", "expense:food"]
        ),
    ]
    posted = []
    for _ in range(25):
        if posted and rng.random() < 0.25:  # noqa: PLR2004
            original = rng.choice(posted)
            if original.reversed_by.exists():
                continue
            reverse_transaction(original, created_by=None)
            continue
        payer, *debtors = rng.sample(accounts, rng.randint(2, 5))
        total = Decimal(rng.randint(1, 20_000)) / 100
        shares = allocate(total, [rng.choice([1, 1, 2, 0.5]) for _ in debtors])
        legs = [Leg(a, eur(s)) for a, s in zip(debtors, shares, strict=True) if s]
        legs.append(Leg(payer, eur(-sum(shares))))
        if len(legs) < 2:  # noqa: PLR2004
            continue
        posted.append(
            post_transaction(
                kind=TransactionKind.ADJUSTMENT,
                occurred_on=TODAY,
                description=f"random {seed}",
                legs=legs,
            )
        )

    result = verify_ledger()
    assert result.ok, result
    assert result.trial_balance == 0


@pytest.mark.django_db(transaction=True)
def test_concurrent_postings_with_one_idempotency_key_post_once():
    """Two requests completing the same booking at once produce one transaction."""
    book = Book.objects.default()
    bank = get_system_account("asset:bank")
    rental = get_system_account("income:rental")
    barrier = threading.Barrier(2)
    results, errors = [], []

    def complete_booking():
        try:
            barrier.wait()
            results.append(
                post_transaction(
                    book=book,
                    kind=TransactionKind.BOOKING_CHARGE,
                    occurred_on=TODAY,
                    description="booking completed",
                    legs=[Leg(bank, eur("10")), Leg(rental, eur("-10"))],
                    idempotency_key="booking:concurrent:charge",
                )
            )
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
        finally:
            connections.close_all()

    threads = [threading.Thread(target=complete_booking) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []
    assert len({tx.pk for tx in results}) == 1
    assert Transaction.objects.count() == 1
    assert verify_ledger().ok


@pytest.mark.django_db(transaction=True)
def test_concurrent_postings_on_shared_accounts_do_not_lose_updates():
    """Row locks on the cached balances serialise overlapping postings."""
    book = Book.objects.default()
    bank = get_system_account("asset:bank")
    rental = get_system_account("income:rental")
    food = get_system_account("expense:food")
    barrier = threading.Barrier(4)
    errors = []

    def worker(i):
        try:
            barrier.wait()
            for _ in range(10):
                # Alternate account order between threads to provoke deadlocks
                # if locking were not ordered.
                a, b = (rental, food) if i % 2 else (food, rental)
                post_transaction(
                    book=book,
                    kind=TransactionKind.ADJUSTMENT,
                    occurred_on=TODAY,
                    description=f"worker {i}",
                    legs=[Leg(bank, eur("2")), Leg(a, eur("-1")), Leg(b, eur("-1"))],
                )
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
        finally:
            connections.close_all()

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []
    bank.balance.refresh_from_db()
    assert bank.balance.balance == Decimal("80.00")
    assert verify_ledger().ok
    assert connection.vendor == "postgresql"
