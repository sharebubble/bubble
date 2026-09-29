"""Disputes, reversals, corrections and comments (plan D9, phase 4).

A posted transaction is never changed. Members dispute or discuss it; the
author, the members it credits or the treasurer answer with a reversal, a
partial correction, or by keeping it with a reason.
"""

from decimal import Decimal

import pytest
from django.contrib.auth.models import Group
from django.db import connection
from rest_framework import status
from rest_framework.test import APIClient

from bubble.ledger.exceptions import ImmutableLedgerError
from bubble.ledger.intents import LEDGER_ADMIN_GROUP
from bubble.ledger.models import (
    Dispute,
    DisputeState,
    TransactionComment,
    TransactionKind,
)
from bubble.ledger.tests.helpers import display_balance

TRANSACTIONS = "/api/ledger/transactions/"
DISPUTES = "/api/ledger/disputes/"


@pytest.fixture
def client_for():
    def _client(account):
        client = APIClient()
        client.default_format = "json"
        client.force_authenticate(account.owner)
        return client

    return _client


@pytest.fixture
def treasurer(members):
    group, _ = Group.objects.get_or_create(name=LEDGER_ADMIN_GROUP)
    members["dan"].owner.groups.add(group)
    return members["dan"]


@pytest.fixture
def dinner(members, post):
    """Alice paid 45 € for dinner; Bob, Carla and Dan owe her 15 € each."""
    alice, bob, carla, dan = (members[n] for n in ["alice", "bob", "carla", "dan"])
    return post(
        (bob, 15),
        (carla, 15),
        (dan, 15),
        (alice, -45),
        kind=TransactionKind.SHARED_EXPENSE,
        description="Dinner",
        created_by=alice,
    )


def entry_of(tx, account):
    return tx.entries.get(account=account)


def dispute(client, tx, reason="Dan was not there"):
    return client.post(f"{TRANSACTIONS}{tx.pk}/dispute/", {"reason": reason})


class TestDisputes:
    def test_any_member_can_dispute_and_the_feed_shows_it(
        self, members, client_for, dinner, notices, django_capture_on_commit_callbacks
    ):
        with django_capture_on_commit_callbacks(execute=True):
            response = dispute(client_for(members["bob"]), dinner)

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert response.data["state"] == "open"
        assert response.data["raised_by"]["name"] == "Bob"
        # Everyone involved but Bob hears about it.
        told = {user.username for user, context in notices}
        assert told == {"alice", "carla", "dan"}
        assert all(c["kind"] == "disputed" for _u, c in notices)

        listed = client_for(members["carla"]).get(TRANSACTIONS, {"disputed": True})
        assert [t["id"] for t in listed.data["results"]] == [str(dinner.pk)]
        assert listed.data["results"][0]["open_disputes"] == 1
        detail = client_for(members["carla"]).get(f"{TRANSACTIONS}{dinner.pk}/")
        assert detail.data["disputes"][0]["reason"] == "Dan was not there"

    def test_one_open_dispute_per_member_and_a_reason_is_needed(
        self, members, client_for, dinner
    ):
        bob = client_for(members["bob"])
        assert dispute(bob, dinner).status_code == status.HTTP_201_CREATED
        again = dispute(bob, dinner)
        assert again.status_code == status.HTTP_400_BAD_REQUEST
        assert "reason" in again.data
        empty = dispute(client_for(members["carla"]), dinner, reason="   ")
        assert empty.status_code == status.HTTP_400_BAD_REQUEST

    def test_only_the_raiser_withdraws(self, members, client_for, dinner):
        bob = client_for(members["bob"])
        pk = dispute(bob, dinner).data["id"]

        other = client_for(members["carla"]).post(f"{DISPUTES}{pk}/withdraw/")
        assert other.status_code == status.HTTP_403_FORBIDDEN
        response = bob.post(f"{DISPUTES}{pk}/withdraw/")
        assert response.status_code == status.HTTP_200_OK
        assert response.data["state"] == "withdrawn"
        assert (
            bob.post(f"{DISPUTES}{pk}/withdraw/").status_code
            == status.HTTP_400_BAD_REQUEST
        )
        # Withdrawn, Bob may raise it again.
        assert dispute(bob, dinner).status_code == status.HTTP_201_CREATED

    def test_the_author_keeps_it_with_a_reason(
        self, members, client_for, dinner, notices, django_capture_on_commit_callbacks
    ):
        pk = dispute(client_for(members["bob"]), dinner).data["id"]

        charged = client_for(members["carla"]).post(
            f"{DISPUTES}{pk}/uphold/", {"resolution": "It is right"}
        )
        assert charged.status_code == status.HTTP_403_FORBIDDEN
        no_reason = client_for(members["alice"]).post(
            f"{DISPUTES}{pk}/uphold/", {"resolution": ""}
        )
        assert no_reason.status_code == status.HTTP_400_BAD_REQUEST
        with django_capture_on_commit_callbacks(execute=True):
            response = client_for(members["alice"]).post(
                f"{DISPUTES}{pk}/uphold/", {"resolution": "Dan ate with us."}
            )

        assert response.status_code == status.HTTP_200_OK, response.data
        assert response.data["state"] == "upheld"
        assert response.data["resolution"] == "Dan ate with us."
        assert response.data["resolved_by"]["name"] == "Alice"
        assert [(u.username, c["kind"]) for u, c in notices] == [
            ("bob", "dispute_resolved")
        ]
        assert display_balance(members["dan"]) == Decimal("-15.00")

    def test_the_treasurer_may_answer(self, members, client_for, dinner, treasurer):
        pk = dispute(client_for(members["bob"]), dinner).data["id"]
        response = client_for(treasurer).post(
            f"{DISPUTES}{pk}/uphold/", {"resolution": "Checked the receipt."}
        )
        assert response.status_code == status.HTTP_200_OK


class TestReversal:
    def test_the_author_reverses_and_the_dispute_is_resolved(
        self, members, client_for, dinner
    ):
        pk = dispute(client_for(members["bob"]), dinner).data["id"]

        response = client_for(members["alice"]).post(
            f"{TRANSACTIONS}{dinner.pk}/reverse/", {"description": "Wrong bill"}
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert response.data["kind"] == "reversal"
        assert str(response.data["reverses"]) == str(dinner.pk)
        assert response.data["description"] == "Wrong bill"
        for name in ["alice", "bob", "carla", "dan"]:
            assert display_balance(members[name]) == Decimal("0.00")
        assert Dispute.objects.get(pk=pk).state == DisputeState.REVERSED
        again = client_for(members["alice"]).post(f"{TRANSACTIONS}{dinner.pk}/reverse/")
        assert again.status_code == status.HTTP_400_BAD_REQUEST

    def test_who_may_reverse(self, members, client_for, dinner, treasurer, post):
        # Bob is charged, not credited: he disputes instead.
        bob = client_for(members["bob"])
        assert bob.get(f"{TRANSACTIONS}{dinner.pk}/").data["can_reverse"] is False
        assert (
            bob.post(f"{TRANSACTIONS}{dinner.pk}/reverse/").status_code
            == status.HTTP_403_FORBIDDEN
        )
        alice = client_for(members["alice"])
        assert alice.get(f"{TRANSACTIONS}{dinner.pk}/").data["can_reverse"] is True
        # The treasurer (Dan here) may, and so may a member it credits even
        # when somebody else posted it.
        assert (
            client_for(treasurer).get(f"{TRANSACTIONS}{dinner.pk}/").data["can_reverse"]
        )
        gift = post(("expense:tools", 10), (members["carla"], -10), created_by=None)
        carla = client_for(members["carla"])
        assert (
            carla.post(f"{TRANSACTIONS}{gift.pk}/reverse/").status_code
            == status.HTTP_201_CREATED
        )

    def test_a_reversal_is_not_reversed_again(self, members, client_for, dinner):
        alice = client_for(members["alice"])
        reversal = alice.post(f"{TRANSACTIONS}{dinner.pk}/reverse/").data
        assert reversal["can_reverse"] is False
        response = alice.post(f"{TRANSACTIONS}{reversal['id']}/reverse/")
        assert response.status_code == status.HTTP_400_BAD_REQUEST


class TestCorrection:
    def test_undo_one_share(self, members, client_for, dinner):
        alice, dan = members["alice"], members["dan"]
        pk = dispute(client_for(members["bob"]), dinner).data["id"]

        response = client_for(alice).post(
            f"{TRANSACTIONS}{dinner.pk}/correct/",
            {
                "description": "Dan was not there",
                "lines": [
                    {"entry": str(entry_of(dinner, dan).pk), "amount": "15.00"},
                    {"entry": str(entry_of(dinner, alice).pk), "amount": "15.00"},
                ],
            },
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert response.data["kind"] == "correction"
        assert display_balance(dan) == Decimal("0.00")
        assert display_balance(alice) == Decimal("30.00")
        assert display_balance(members["bob"]) == Decimal("-15.00")
        closed = Dispute.objects.get(pk=pk)
        assert closed.state == DisputeState.CORRECTED
        assert "Dan was not there" in closed.resolution
        remaining = (
            client_for(alice).get(f"{TRANSACTIONS}{dinner.pk}/").data["remaining"]
        )
        assert remaining[str(entry_of(dinner, dan).pk)] == "0.00"
        assert remaining[str(entry_of(dinner, alice).pk)] == "-30.00"

    @pytest.mark.parametrize(
        ("dan_amount", "alice_amount"),
        [("15.00", "10.00"), ("20.00", "20.00"), ("0", "0")],
        ids=["unbalanced", "more-than-left", "nothing"],
    )
    def test_bad_lines_are_refused(
        self, members, client_for, dinner, dan_amount, alice_amount
    ):
        alice, dan = members["alice"], members["dan"]
        response = client_for(alice).post(
            f"{TRANSACTIONS}{dinner.pk}/correct/",
            {
                "lines": [
                    {"entry": str(entry_of(dinner, dan).pk), "amount": dan_amount},
                    {"entry": str(entry_of(dinner, alice).pk), "amount": alice_amount},
                ]
            },
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "lines" in response.data
        assert display_balance(dan) == Decimal("-15.00")

    def test_lines_of_another_transaction_are_refused(
        self, members, client_for, dinner, post
    ):
        other = post((members["alice"], 5), ("expense:tools", -5))
        response = client_for(members["alice"]).post(
            f"{TRANSACTIONS}{dinner.pk}/correct/",
            {"lines": [{"entry": str(other.entries.first().pk), "amount": "5.00"}]},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_charged_members_cannot_correct(self, members, client_for, dinner):
        dan = members["dan"]
        response = client_for(dan).post(
            f"{TRANSACTIONS}{dinner.pk}/correct/",
            {
                "lines": [
                    {"entry": str(entry_of(dinner, dan).pk), "amount": "15.00"},
                    {
                        "entry": str(entry_of(dinner, members["alice"]).pk),
                        "amount": "15.00",
                    },
                ]
            },
            format="json",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN


class TestComments:
    def test_members_discuss_and_the_involved_are_told(
        self, members, client_for, dinner, notices, django_capture_on_commit_callbacks
    ):
        with django_capture_on_commit_callbacks(execute=True):
            response = client_for(members["bob"]).post(
                f"{TRANSACTIONS}{dinner.pk}/comments/", {"body": "Was Dan there?"}
            )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert response.data["author"]["name"] == "Bob"
        assert {u.username for u, _c in notices} == {"alice", "carla", "dan"}
        detail = client_for(members["carla"]).get(f"{TRANSACTIONS}{dinner.pk}/")
        assert [c["body"] for c in detail.data["comments"]] == ["Was Dan there?"]
        empty = client_for(members["bob"]).post(
            f"{TRANSACTIONS}{dinner.pk}/comments/", {"body": ""}
        )
        assert empty.status_code == status.HTTP_400_BAD_REQUEST

    def test_comments_are_never_edited(self, members, client_for, dinner):
        client_for(members["bob"]).post(
            f"{TRANSACTIONS}{dinner.pk}/comments/", {"body": "Hm"}
        )
        comment = TransactionComment.objects.get()
        with pytest.raises(ImmutableLedgerError):
            comment.delete()
        with pytest.raises(Exception, match="append-only"), connection.cursor() as c:
            c.execute("UPDATE ledger_transactioncomment SET body = 'forged'")
