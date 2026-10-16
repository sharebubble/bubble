"""The hash chain and daily digest (plan section 11, phase 6)."""

import csv
import hashlib
import io

import pytest
from constance.test import override_config
from django.db import connection, transaction
from rest_framework import status
from rest_framework.test import APIClient

from bubble.ledger.chain import GENESIS, publish_digest, verify_chain
from bubble.ledger.models import LedgerDigest, TransactionKind, TransactionSeal
from bubble.ledger.services import reverse_transaction


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
