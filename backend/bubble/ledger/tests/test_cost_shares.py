"""Shared expenses (plan 7a, D13): charging other members with their consent."""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from bubble.ledger.cost_shares import process_cost_share_deadlines
from bubble.ledger.models import (
    CostShare,
    CostShareState,
    Transaction,
    TransactionKind,
)
from bubble.ledger.tests.helpers import TODAY, display_balance

SPLITS = "/api/ledger/splits/"
TRANSACTIONS = "/api/ledger/transactions/"
PDF = b"%PDF-1.4\n% dinner bill\n%%EOF\n"


@pytest.fixture
def client_for():
    def _client(account):
        client = APIClient()
        client.default_format = "json"
        client.force_authenticate(account.owner)
        return client

    return _client


@pytest.fixture
def split(members, client_for):
    """Alice splits a bill with Bob and Carla (and herself, by default)."""

    def _split(total="45.00", participants=("bob", "carla"), **data):
        body = {
            "description": "Dinner",
            "total": total,
            "occurred_on": TODAY.isoformat(),
            "participants": [
                p if isinstance(p, dict) else {"account": str(members[p].pk)}
                for p in participants
            ],
            **data,
        }
        return client_for(members["alice"]).post(SPLITS, body)

    return _split


def shares(data):
    return {p["account"]["name"]: p["share"] for p in data["participants"]}


def answer(client, pk, accept=True, reason=""):
    action = "accept" if accept else "object"
    return client.post(f"{SPLITS}{pk}/{action}/", {"reason": reason})


class TestCreating:
    def test_equal_shares_and_everyone_is_asked(
        self, members, split, notices, django_capture_on_commit_callbacks
    ):
        with django_capture_on_commit_callbacks(execute=True):
            response = split()

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert response.data["state"] == "open"
        assert response.data["is_payer"] is True
        assert response.data["payer_share"] == "15.00"
        assert shares(response.data) == {"Bob": "15.00", "Carla": "15.00"}
        assert [(u.username, c["kind"], c["amount"]) for u, c in notices] == [
            ("bob", "cost_share_added", "15.00 EUR"),
            ("carla", "cost_share_added", "15.00 EUR"),
        ]
        # Nothing is booked before the answers.
        assert not Transaction.objects.filter(kind=TransactionKind.SHARED_EXPENSE)
        assert display_balance(members["bob"]) == Decimal("0.00")

    def test_weights_and_guests(self, members, split):
        response = split(
            total="40.00",
            split="weights",
            payer_participates=False,
            participants=[
                {"account": str(members["bob"].pk), "weight": "2"},
                {"account": str(members["carla"].pk), "guests": 1},
            ],
        )
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert shares(response.data) == {"Bob": "20.00", "Carla": "20.00"}
        assert response.data["payer_share"] == "0.00"

    def test_equal_split_counts_guests_but_ignores_weights(self, members, split):
        response = split(
            total="40.00",
            participants=[
                {"account": str(members["bob"].pk), "weight": "5"},
                {"account": str(members["carla"].pk), "guests": 2},
            ],
        )
        assert shares(response.data) == {"Bob": "8.00", "Carla": "24.00"}
        assert response.data["payer_share"] == "8.00"

    def test_fixed_amounts_leave_the_rest_to_the_payer(self, members, split):
        response = split(
            total="30.00",
            split="amounts",
            participants=[
                {"account": str(members["bob"].pk), "amount": "10.00"},
                {"account": str(members["carla"].pk), "amount": "5.00"},
            ],
        )
        assert shares(response.data) == {"Bob": "10.00", "Carla": "5.00"}
        assert response.data["payer_share"] == "15.00"

    @pytest.mark.parametrize(
        ("change", "field"),
        [
            ({"participants": ["alice"]}, "participants"),
            ({"participants": ["bob", "bob"]}, "participants"),
            ({"participants": []}, "participants"),
            ({"total": "0.00"}, "total"),
            (
                {"occurred_on": (TODAY + timedelta(days=9999)).isoformat()},
                "occurred_on",
            ),
        ],
        ids=["payer", "twice", "nobody", "zero", "future"],
    )
    def test_invalid_splits_are_refused(self, split, change, field):
        response = split(**change)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert field in response.data

    def test_fixed_amounts_may_not_exceed_the_total(self, members, split):
        response = split(
            total="10.00",
            split="amounts",
            participants=[{"account": str(members["bob"].pk), "amount": "11.00"}],
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST


class TestAnswering:
    def test_all_accept_and_it_is_booked(
        self, members, split, client_for, notices, django_capture_on_commit_callbacks
    ):
        pk = split().data["id"]
        client_for(members["alice"]).post(
            f"{SPLITS}{pk}/receipts/",
            {"file": SimpleUploadedFile("bill.pdf", PDF)},
            format="multipart",
        )
        assert answer(client_for(members["bob"]), pk).data["state"] == "open"
        with django_capture_on_commit_callbacks(execute=True):
            response = answer(client_for(members["carla"]), pk)

        assert response.status_code == status.HTTP_200_OK, response.data
        assert response.data["state"] == "posted"
        tx = Transaction.objects.get(pk=response.data["posted_transaction"])
        assert tx.kind == TransactionKind.SHARED_EXPENSE
        assert tx.category.code == "shared-expense"
        assert tx.idempotency_key == f"cost_share:{pk}"
        assert display_balance(members["alice"]) == Decimal("30.00")
        assert display_balance(members["bob"]) == Decimal("-15.00")
        assert display_balance(members["carla"]) == Decimal("-15.00")
        # Everyone charged or credited hears about the booking.
        posted = {u.username for u, c in notices if c["kind"] == "posted"}
        assert posted == {"alice", "bob", "carla"}
        # The split's receipt documents the transaction.
        detail = client_for(members["dan"]).get(f"{TRANSACTIONS}{tx.pk}/").data
        assert detail["cost_share"] == pk
        assert [r["file_name"] for r in detail["receipts"]] == ["bill.pdf"]
        assert detail["receipt_count"] == 1
        listed = client_for(members["dan"]).get(TRANSACTIONS, {"has_receipt": True})
        assert [t["id"] for t in listed.data["results"]] == [str(tx.pk)]

    def test_an_objection_removes_only_that_share(
        self, members, split, client_for, notices, django_capture_on_commit_callbacks
    ):
        pk = split().data["id"]
        carla = client_for(members["carla"])
        assert (
            answer(carla, pk, accept=False).status_code == status.HTTP_400_BAD_REQUEST
        )
        with django_capture_on_commit_callbacks(execute=True):
            objected = answer(carla, pk, accept=False, reason="I only had water")
        assert objected.status_code == status.HTTP_200_OK
        assert [(u.username, c["kind"]) for u, c in notices] == [
            ("alice", "cost_share_objected")
        ]

        response = answer(client_for(members["bob"]), pk)

        assert response.data["state"] == "posted"
        # Carla's share was not moved onto Bob; Alice carries it.
        assert shares(response.data) == {"Bob": "15.00", "Carla": "15.00"}
        assert display_balance(members["bob"]) == Decimal("-15.00")
        assert display_balance(members["carla"]) == Decimal("0.00")
        assert display_balance(members["alice"]) == Decimal("15.00")

    def test_nobody_left_cancels_it(self, members, split, client_for):
        pk = split(participants=["bob"]).data["id"]
        response = answer(client_for(members["bob"]), pk, accept=False, reason="No")
        assert response.data["state"] == "cancelled"
        assert not Transaction.objects.filter(kind=TransactionKind.SHARED_EXPENSE)

    def test_only_participants_answer(self, members, split, client_for):
        pk = split().data["id"]
        assert (
            answer(client_for(members["dan"]), pk).status_code
            == status.HTTP_403_FORBIDDEN
        )
        assert (
            answer(client_for(members["alice"]), pk).status_code
            == status.HTTP_403_FORBIDDEN
        )

    def test_waiting_for_me(self, members, split, client_for):
        pk = split().data["id"]
        bob = client_for(members["bob"])
        waiting = bob.get(SPLITS, {"waiting_for_me": True}).data["results"]
        assert [s["id"] for s in waiting] == [pk]
        assert waiting[0]["my_response"] == "pending"
        answer(bob, pk)
        assert bob.get(SPLITS, {"waiting_for_me": True}).data["results"] == []
        assert [s["id"] for s in bob.get(SPLITS, {"mine": True}).data["results"]] == [
            pk
        ]
        assert (
            client_for(members["dan"]).get(SPLITS, {"mine": True}).data["results"] == []
        )


class TestChanging:
    def test_an_edit_asks_everyone_again(
        self, members, split, client_for, notices, django_capture_on_commit_callbacks
    ):
        data = split().data
        answer(client_for(members["bob"]), data["id"])
        body = {
            "description": "Dinner and drinks",
            "total": "60.00",
            "occurred_on": TODAY.isoformat(),
            "participants": [
                {"account": str(members["bob"].pk)},
                {"account": str(members["carla"].pk)},
            ],
        }
        forbidden = client_for(members["bob"]).put(f"{SPLITS}{data['id']}/", body)
        assert forbidden.status_code == status.HTTP_403_FORBIDDEN

        with django_capture_on_commit_callbacks(execute=True):
            response = client_for(members["alice"]).put(f"{SPLITS}{data['id']}/", body)

        assert response.status_code == status.HTTP_200_OK, response.data
        assert {p["response"] for p in response.data["participants"]} == {"pending"}
        assert shares(response.data) == {"Bob": "20.00", "Carla": "20.00"}
        assert response.data["auto_accept_at"] >= data["auto_accept_at"]
        assert {(u.username, c["kind"]) for u, c in notices} == {
            ("bob", "cost_share_changed"),
            ("carla", "cost_share_changed"),
        }

    def test_the_payer_cancels(self, members, split, client_for):
        pk = split().data["id"]
        bob = client_for(members["bob"])
        assert (
            bob.post(f"{SPLITS}{pk}/cancel/").status_code == status.HTTP_403_FORBIDDEN
        )
        response = client_for(members["alice"]).post(
            f"{SPLITS}{pk}/cancel/", {"reason": "Paid by the club"}
        )
        assert response.data["state"] == "cancelled"
        assert response.data["cancelled_reason"] == "Paid by the club"
        assert answer(bob, pk).status_code == status.HTTP_400_BAD_REQUEST

    def test_only_the_payer_adds_receipts(self, members, split, client_for):
        pk = split().data["id"]
        response = client_for(members["bob"]).post(
            f"{SPLITS}{pk}/receipts/",
            {"file": SimpleUploadedFile("bill.pdf", PDF)},
            format="multipart",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN


class TestDeadline:
    def test_a_reminder_a_day_before_then_silence_is_consent(
        self, members, split, client_for, notices, django_capture_on_commit_callbacks
    ):
        pk = split().data["id"]
        answer(client_for(members["bob"]), pk)
        deadline = CostShare.objects.get(pk=pk).auto_accept_at
        assert deadline - timezone.now() > timedelta(days=2)

        assert process_cost_share_deadlines(deadline - timedelta(days=2)) == (0, 0)
        with django_capture_on_commit_callbacks(execute=True):
            assert process_cost_share_deadlines(deadline - timedelta(hours=12)) == (
                1,
                0,
            )
            # Once is enough.
            assert process_cost_share_deadlines(deadline - timedelta(hours=1)) == (
                0,
                0,
            )
        assert [(u.username, c["kind"]) for u, c in notices] == [
            ("carla", "cost_share_reminder")
        ]

        assert process_cost_share_deadlines(deadline + timedelta(minutes=1)) == (0, 1)

        cs = CostShare.objects.get(pk=pk)
        assert cs.state == CostShareState.POSTED
        assert display_balance(members["carla"]) == Decimal("-15.00")
        assert process_cost_share_deadlines(deadline + timedelta(hours=2)) == (0, 0)
