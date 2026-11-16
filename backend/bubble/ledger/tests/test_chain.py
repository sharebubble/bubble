"""The hash chain and daily digest (plan section 11, phase 6)."""

import csv
import datetime
import hashlib
import io

import pytest
from constance.test import override_config
from django.apps import apps as django_apps
from django.db import connection, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from bubble.ledger.chain import GENESIS, publish_digest, verify_chain
from bubble.ledger.intents import ReceiptData, store_receipt
from bubble.ledger.models import (
    LedgerDigest,
    ReceiptSeal,
    TransactionKind,
    TransactionSeal,
)
from bubble.ledger.services import reverse_transaction

CHANNEL = "rocket://x/#ledger"
PDF = "application/pdf"


@pytest.fixture
def three(members, post):
    alice, bob = members["alice"], members["bob"]
    return [
        post(("expense:tools", 50), (alice, -50), kind=TransactionKind.MEMBER_EXPENSE),
        post((bob, 20), ("income:rental", -20), kind=TransactionKind.BOOKING_CHARGE),
        post(("asset:bank", 30), (bob, -30), kind=TransactionKind.TOP_UP),
    ]


def tamper(sql, params):
    """Change a ledger row behind the app's back, as a database admin could."""
    with connection.cursor() as cursor:
        # A superuser can switch triggers off for the session.
        cursor.execute("SET session_replication_role = replica")
        cursor.execute(sql, params)
        cursor.execute("SET session_replication_role = origin")


class TestSealing:
    def test_every_posting_is_linked_to_the_previous_one(self, book, three):
        seals = list(TransactionSeal.objects.filter(book=book).order_by("position"))
        assert [s.transaction_id for s in seals] == [t.pk for t in three]
        assert [s.position for s in seals] == [1, 2, 3]
        assert seals[0].prev_hash == GENESIS
        assert seals[1].prev_hash == seals[0].hash
        assert seals[2].prev_hash == seals[1].hash
        check = verify_chain(book)
        assert check.ok
        assert check.length == 3  # noqa: PLR2004
        assert check.head_hash == seals[2].hash

    def test_reversals_are_sealed_too(self, book, three, members):
        reversal = reverse_transaction(three[0], created_by=members["alice"])
        assert reversal.seal.position == 4  # noqa: PLR2004
        assert verify_chain(book).ok

    def test_seals_are_append_only(self, three):
        link = three[0].seal
        with pytest.raises(Exception, match="append-only"), connection.cursor() as c:
            c.execute("UPDATE ledger_transactionseal SET hash = 'x'")
        assert link.hash != "x"


class TestTampering:
    def test_an_edited_description_breaks_the_chain_from_there(self, book, three):
        tamper(
            "UPDATE ledger_transaction SET description = %s WHERE id = %s",
            ["Drill (cheaper)", three[1].pk],
        )
        check = verify_chain(book)
        assert not check.ok
        assert check.broken_at == 2  # noqa: PLR2004

    def test_an_edited_date_is_caught_as_well(self, book, three):
        tamper(
            "UPDATE ledger_transaction SET occurred_on = occurred_on - 1 WHERE id = %s",
            [three[0].pk],
        )
        assert verify_chain(book).broken_at == 1


class TestDigest:
    def test_published_to_the_channel(self, book, three, monkeypatch):
        sent = []
        monkeypatch.setattr(
            "bubble.notifications.providers.apprise_provider.send_apprise_notification",
            lambda url, title, body: sent.append((url, title, body)) or True,
        )
        with override_config(LEDGER_DIGEST_APPRISE_URL="rocket://x/#ledger"):
            digest = publish_digest(book)

        head = three[2].seal
        assert digest.chain_ok
        assert digest.published
        assert (digest.position, digest.head_hash) == (3, head.hash)
        [(url, title, body)] = sent
        assert url == "rocket://x/#ledger"
        assert "digest" in title
        assert head.hash in body

    def test_kept_in_the_app_without_a_channel(self, book, three):
        digest = publish_digest(book)
        assert digest.chain_ok
        assert not digest.published

    def test_a_broken_chain_is_reported_not_hidden(
        self, book, three, members, monkeypatch
    ):
        sent = []
        monkeypatch.setattr(
            "bubble.notifications.providers.apprise_provider.send_apprise_notification",
            lambda url, title, body: sent.append(title) or True,
        )
        tamper(
            "UPDATE ledger_transaction SET description = 'x' WHERE id = %s",
            [three[2].pk],
        )
        with override_config(LEDGER_DIGEST_APPRISE_URL="rocket://x/#ledger"):
            digest = publish_digest(book)
        assert not digest.chain_ok
        assert "BROKEN" in sent[0]

        client = APIClient()
        client.force_authenticate(members["carla"].owner)
        health = client.get("/api/ledger/health/").data
        assert health["chain_ok"] is False
        assert health["ok"] is False


class TestApi:
    def test_head_digests_and_seal_on_the_transaction(self, book, three, members):
        publish_digest(book)
        client = APIClient()
        client.force_authenticate(members["dan"].owner)

        response = client.get("/api/ledger/chain/")

        assert response.status_code == status.HTTP_200_OK
        assert response.data["head"]["position"] == 3  # noqa: PLR2004
        assert response.data["head"]["hash"] == three[2].seal.hash
        assert response.data["digest_channel"] is False
        assert len(response.data["digests"]) == 1
        detail = client.get(f"/api/ledger/transactions/{three[1].pk}/").data
        assert detail["seal"]["position"] == 2  # noqa: PLR2004
        assert detail["seal"]["prev_hash"] == three[0].seal.hash

    def test_the_export_verifies_on_its_own(self, three, members):
        client = APIClient()
        client.force_authenticate(members["dan"].owner)

        response = client.get("/api/ledger/chain/export/")

        assert response.status_code == status.HTTP_200_OK
        rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
        prev = GENESIS
        for row in rows:
            assert row["prev_hash"] == prev
            recomputed = hashlib.sha256(
                row["prev_hash"].encode() + row["canonical"].encode()
            ).hexdigest()
            assert recomputed == row["hash"]
            prev = row["hash"]
        assert prev == three[2].seal.hash

    def test_digests_are_append_only(self, book, three):
        publish_digest(book)
        with (
            pytest.raises(Exception, match="append-only"),
            transaction.atomic(),
            connection.cursor() as c,
        ):
            c.execute("UPDATE ledger_ledgerdigest SET head_hash = 'x'")
        assert LedgerDigest.objects.get().head_hash != "x"


@pytest.fixture
def receipts(three, members):
    """Two receipts: one on the first transaction, one added later to the third."""
    alice = members["alice"]
    return [
        store_receipt(
            three[0], alice, ReceiptData("a.pdf", "application/pdf", b"%PDF-a")
        ),
        store_receipt(
            three[2], alice, ReceiptData("b.pdf", "application/pdf", b"%PDF-b")
        ),
    ]


class TestReceiptChain:
    def test_every_receipt_is_linked_to_the_previous_one(self, book, receipts):
        seals = list(ReceiptSeal.objects.filter(book=book).order_by("position"))
        assert [s.receipt_id for s in seals] == [r.pk for r in receipts]
        assert seals[0].prev_hash == GENESIS
        assert seals[1].prev_hash == seals[0].hash
        check = verify_chain(book)
        assert check.ok
        assert (check.receipt_length, check.receipt_head_hash) == (2, seals[1].hash)

    def test_a_swapped_file_is_caught_even_with_its_hash_changed(self, book, receipts):
        # A database admin replaces the file and fixes up the stored hash.
        fake = b"%PDF-forged"
        tamper(
            "UPDATE ledger_receipt SET content = %s, sha256 = %s, size = %s "
            "WHERE id = %s",
            [fake, hashlib.sha256(fake).hexdigest(), len(fake), receipts[0].pk],
        )
        check = verify_chain(book)
        assert not check.ok
        assert check.receipt_broken_at == 1
        # The transaction chain itself is untouched.
        assert check.broken_at is None

    def test_a_swapped_file_alone_is_caught_too(self, book, receipts):
        tamper(
            "UPDATE ledger_receipt SET content = %s WHERE id = %s",
            [b"%PDF-x", receipts[1].pk],
        )
        assert verify_chain(book).receipt_broken_at == 2  # noqa: PLR2004

    def test_a_receipt_slipped_in_without_a_seal_is_caught(self, book, receipts):
        tamper("DELETE FROM ledger_receiptseal WHERE receipt_id = %s", [receipts[1].pk])
        check = verify_chain(book)
        assert not check.ok
        assert check.unsealed_receipts == 1

    def test_receipt_seals_are_append_only(self, receipts):
        with (
            pytest.raises(Exception, match="append-only"),
            transaction.atomic(),
            connection.cursor() as c,
        ):
            c.execute("UPDATE ledger_receiptseal SET hash = 'x'")

    def test_the_digest_carries_the_receipt_head(self, book, receipts, monkeypatch):
        sent = []
        monkeypatch.setattr(
            "bubble.notifications.providers.apprise_provider.send_apprise_notification",
            lambda url, title, body: sent.append(body) or True,
        )
        with override_config(LEDGER_DIGEST_APPRISE_URL=CHANNEL):
            digest = publish_digest(book)
        head = receipts[1].seal.hash
        assert (digest.receipt_position, digest.receipt_head_hash) == (2, head)
        assert head in sent[0]

    def test_existing_receipts_are_sealed_by_the_migration(self, book, receipts):
        migration = __import__(
            "bubble.ledger.migrations.0008_receipt_chain", fromlist=["x"]
        )
        before = [s.hash for s in ReceiptSeal.objects.order_by("position")]
        tamper("DELETE FROM ledger_receiptseal", [])
        migration.seal_existing_receipts(django_apps, None)
        assert [s.hash for s in ReceiptSeal.objects.order_by("position")] == before

    def test_export_and_head_over_the_api(self, receipts, members):
        client = APIClient()
        client.force_authenticate(members["dan"].owner)
        head = client.get("/api/ledger/chain/").data["receipt_head"]
        assert head == {"position": 2, "hash": receipts[1].seal.hash}

        response = client.get("/api/ledger/chain/receipts/export/")
        rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
        prev = GENESIS
        for row in rows:
            assert row["prev_hash"] == prev
            prev = hashlib.sha256((prev + row["canonical"]).encode()).hexdigest()
            assert prev == row["hash"]
        assert prev == head["hash"]
        assert hashlib.sha256(b"%PDF-a").hexdigest() in rows[0]["canonical"]


class TestDigestIsRequired:
    def health(self, members):
        client = APIClient()
        client.force_authenticate(members["carla"].owner)
        return client.get("/api/ledger/health/").data

    def test_no_channel_fails_the_health_check(self, three, members):
        health = self.health(members)
        assert health["digest_channel"] is False
        assert health["digest_ok"] is False
        assert health["ok"] is False

    @override_config(LEDGER_DIGEST_APPRISE_URL=CHANNEL)
    def test_a_digest_that_could_not_be_sent_fails_it(
        self, book, three, members, monkeypatch
    ):
        monkeypatch.setattr(
            "bubble.notifications.providers.apprise_provider.send_apprise_notification",
            lambda url, title, body: False,
        )
        assert self.health(members)["ok"] is True
        assert publish_digest(book).published is False
        health = self.health(members)
        assert (health["chain_ok"], health["digest_ok"], health["ok"]) == (
            True,
            False,
            False,
        )

    @override_config(LEDGER_DIGEST_APPRISE_URL=CHANNEL)
    def test_an_overdue_digest_fails_it(self, book, three, members, monkeypatch):
        monkeypatch.setattr(
            "bubble.notifications.providers.apprise_provider.send_apprise_notification",
            lambda url, title, body: True,
        )
        publish_digest(book)
        assert self.health(members)["ok"] is True
        three_days = timezone.now() + datetime.timedelta(days=3)
        monkeypatch.setattr(timezone, "now", lambda: three_days)
        health = self.health(members)
        assert (health["digest_ok"], health["ok"]) == (False, False)
