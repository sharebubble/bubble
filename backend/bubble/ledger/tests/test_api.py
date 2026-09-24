"""The /api/ledger/ endpoints: the drill scenario end to end, and who may do what."""

import datetime
import hashlib
from decimal import Decimal

import pytest
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from bubble.ledger.exceptions import ImmutableLedgerError
from bubble.ledger.intents import LEDGER_ADMIN_GROUP
from bubble.ledger.models import (
    Category,
    Receipt,
    ReceiptAccess,
    Transaction,
)
from bubble.ledger.services import get_member_account, get_system_account
from bubble.ledger.tests.helpers import TODAY, display_balance

PDF = b"%PDF-1.4\n% a receipt for a drill\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32

TRANSACTIONS = "/api/ledger/transactions/"
ACCOUNTS = "/api/ledger/accounts/"


def receipt_file(content=PDF, name="drill.pdf"):
    return SimpleUploadedFile(name, content, content_type="application/pdf")


@pytest.fixture
def client_for():
    def _client(account):
        client = APIClient()
        client.force_authenticate(account.owner)
        return client

    return _client


@pytest.fixture
def category(book):
    def _category(code):
        return Category.objects.get(book=book, code=code)

    return _category


@pytest.fixture
def treasurer(members):
    group, _ = Group.objects.get_or_create(name=LEDGER_ADMIN_GROUP)
    members["dan"].owner.groups.add(group)
    return members["dan"]


def post_intent(client, **data):
    data.setdefault("occurred_on", TODAY.isoformat())
    data.setdefault("description", "test")
    return client.post(TRANSACTIONS, data, format="multipart")


class TestDrillScenario:
    """Plan phase 2: 'the drill scenario works end to end'."""

    def test_alice_buys_a_drill_and_bob_checks_the_receipt(
        self, members, client_for, category
    ):
        alice, bob = members["alice"], members["bob"]

        response = post_intent(
            client_for(alice),
            intent="expense_for_community",
            amount="50.00",
            category=category("tools").pk,
            description="Cordless drill for the workshop",
            receipts=[receipt_file()],
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        tx = response.data
        assert tx["kind"] == "member_expense"
        assert tx["amount"] == "50.00"
        assert tx["created_by"]["id"] == str(alice.pk)
        assert tx["receipts"][0]["sha256"] == hashlib.sha256(PDF).hexdigest()
        assert tx["receipts"][0]["content_type"] == "application/pdf"
        assert display_balance(alice) == Decimal("50.00")
        assert display_balance(get_system_account("expense:tools")) == Decimal("50.00")

        # Bob sees it in the community feed …
        feed = client_for(bob).get(TRANSACTIONS).data
        assert [row["id"] for row in feed["results"]] == [tx["id"]]
        assert feed["results"][0]["receipt_count"] == 1
        # … and can download the receipt, which is logged.
        receipt_id = tx["receipts"][0]["id"]
        download = client_for(bob).get(f"/api/ledger/receipts/{receipt_id}/file/")
        assert download.status_code == status.HTTP_200_OK
        assert download.content == PDF
        assert download["Content-Disposition"].startswith("attachment")
        assert download["X-Content-Type-Options"] == "nosniff"
        assert ReceiptAccess.objects.get().accessed_by == bob

    def test_alice_sees_her_balance_in_plain_numbers(
        self, members, client_for, category
    ):
        alice = members["alice"]
        client = client_for(alice)
        post_intent(
            client,
            intent="expense_for_community",
            amount="50",
            category=category("tools").pk,
        )
        post_intent(
            client,
            intent="member_to_member",
            amount="20",
            counterparty=members["bob"].pk,
        )

        me = client.get(f"{ACCOUNTS}me/").data
        assert me["id"] == str(alice.pk)
        assert me["balance"] == "30.00"
        assert me["currency"] == "EUR"
        assert me["below_soft_limit"] is False
        assert me["is_ledger_admin"] is False

        statement = client.get(f"{ACCOUNTS}{alice.pk}/entries/").data["results"]
        assert [(row["amount"], row["balance_after"]) for row in statement] == [
            ("-20.00", "30.00"),
            ("50.00", "50.00"),
        ]


class TestIntents:
    def test_top_up_credits_the_member(self, members, client_for):
        response = post_intent(
            client_for(members["bob"]), intent="top_up", amount="30", via="cash"
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert display_balance(members["bob"]) == Decimal("30.00")
        assert display_balance(get_system_account("asset:cash")) == Decimal("30.00")

    def test_member_to_member_charges_only_the_poster(self, members, client_for):
        response = post_intent(
            client_for(members["bob"]),
            intent="member_to_member",
            amount="20",
            counterparty=members["carla"].pk,
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert display_balance(members["bob"]) == Decimal("-20.00")
        assert display_balance(members["carla"]) == Decimal("20.00")

    def test_nobody_owes_themselves(self, members, client_for):
        response = post_intent(
            client_for(members["bob"]),
            intent="member_to_member",
            amount="20",
            counterparty=members["bob"].pk,
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "counterparty" in response.data

    def test_expense_needs_an_expense_category(self, members, client_for, category):
        client = client_for(members["bob"])
        missing = post_intent(client, intent="expense_for_community", amount="5")
        wrong = post_intent(
            client,
            intent="expense_for_community",
            amount="5",
            category=category("donation").pk,
        )
        assert missing.status_code == wrong.status_code == status.HTTP_400_BAD_REQUEST
        assert "category" in missing.data
        assert "category" in wrong.data
        assert not Transaction.objects.exists()

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("amount", "0"),
            ("amount", "-5"),
            ("amount", "1.005"),
            ("amount", "1000000"),
            ("occurred_on", "2999-01-01"),
            ("description", "   "),
        ],
    )
    def test_invalid_input_posts_nothing(self, members, client_for, field, value):
        data = {"intent": "top_up", "amount": "5", field: value}
        response = post_intent(client_for(members["bob"]), **data)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert field in response.data
        assert not Transaction.objects.exists()

    def test_future_dates_follow_the_local_day(self, members, client_for):
        today = timezone.localdate()
        client = client_for(members["bob"])
        ok = post_intent(client, intent="top_up", amount="5", occurred_on=today)
        late = post_intent(
            client,
            intent="top_up",
            amount="5",
            occurred_on=today + datetime.timedelta(days=1),
        )
        assert ok.status_code == status.HTTP_201_CREATED
        assert late.status_code == status.HTTP_400_BAD_REQUEST

    def test_resubmitting_the_same_form_posts_once(self, members, client_for):
        client = client_for(members["bob"])
        first = post_intent(client, intent="top_up", amount="5", client_key="k1")
        second = post_intent(client, intent="top_up", amount="5", client_key="k1")

        assert first.data["id"] == second.data["id"]
        assert Transaction.objects.count() == 1
        # The key is scoped to its author: Carla's k1 is a different posting.
        post_intent(
            client_for(members["carla"]), intent="top_up", amount="5", client_key="k1"
        )
        assert Transaction.objects.count() == 2  # noqa: PLR2004

    def test_json_bodies_work_without_receipts(self, members, client_for):
        response = client_for(members["bob"]).post(
            TRANSACTIONS,
            {
                "intent": "top_up",
                "amount": "5.00",
                "occurred_on": TODAY.isoformat(),
                "description": "json",
            },
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.data


class TestTreasurer:
    def test_members_cannot_post_payouts_or_income(self, members, client_for, category):
        client = client_for(members["bob"])
        payout = post_intent(
            client, intent="payout", amount="5", counterparty=members["bob"].pk
        )
        income = post_intent(
            client, intent="income", amount="5", category=category("donation").pk
        )
        assert payout.status_code == income.status_code == status.HTTP_403_FORBIDDEN
        assert not Transaction.objects.exists()

    def test_the_treasurer_pays_a_member_out(self, members, treasurer, client_for):
        response = post_intent(
            client_for(treasurer),
            intent="payout",
            amount="15",
            counterparty=members["alice"].pk,
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert display_balance(members["alice"]) == Decimal("-15.00")
        assert display_balance(get_system_account("asset:bank")) == Decimal("-15.00")
        assert client_for(treasurer).get(f"{ACCOUNTS}me/").data["is_ledger_admin"]

    def test_the_treasurer_books_a_donation(self, treasurer, client_for, category):
        response = post_intent(
            client_for(treasurer),
            intent="income",
            amount="100",
            category=category("donation").pk,
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert response.data["kind"] == "income"
        assert display_balance(get_system_account("income:donation")) == Decimal(
            "100.00"
        )


class TestReceipts:
    def test_only_real_documents_are_accepted(self, members, client_for):
        response = post_intent(
            client_for(members["bob"]),
            intent="top_up",
            amount="5",
            receipts=[receipt_file(b"<script>alert(1)</script>", "evil.pdf")],
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "receipts" in response.data
        assert not Transaction.objects.exists()

    def test_content_type_is_sniffed_not_trusted(self, members, client_for):
        response = post_intent(
            client_for(members["bob"]),
            intent="top_up",
            amount="5",
            receipts=[receipt_file(PNG, "photo.pdf")],
        )
        assert response.data["receipts"][0]["content_type"] == "image/png"

    def test_the_author_adds_a_receipt_later_others_cannot(self, members, client_for):
        tx = post_intent(client_for(members["bob"]), intent="top_up", amount="5").data
        url = f"{TRANSACTIONS}{tx['id']}/receipts/"

        by_carla = client_for(members["carla"]).post(
            url, {"file": receipt_file()}, format="multipart"
        )
        by_bob = client_for(members["bob"]).post(
            url, {"file": receipt_file()}, format="multipart"
        )

        assert by_carla.status_code == status.HTTP_403_FORBIDDEN
        assert by_bob.status_code == status.HTTP_201_CREATED, by_bob.data
        assert Receipt.objects.filter(transaction_id=tx["id"]).count() == 1

    def test_receipts_are_immutable(self, members, client_for):
        post_intent(
            client_for(members["bob"]),
            intent="top_up",
            amount="5",
            receipts=[receipt_file()],
        )
        receipt = Receipt.objects.get()
        with pytest.raises(ImmutableLedgerError):
            receipt.delete()
        with pytest.raises(Exception, match="append-only"), connection.cursor() as c:
            c.execute("UPDATE ledger_receipt SET sha256 = 'forged'")


class TestReading:
    def test_everything_requires_login(self, members):
        anonymous = APIClient()
        for url in [TRANSACTIONS, ACCOUNTS, f"{ACCOUNTS}me/", "/api/ledger/health/"]:
            assert anonymous.get(url).status_code in (401, 403), url

    def test_receipts_require_login(self, members, client_for):
        post_intent(
            client_for(members["bob"]),
            intent="top_up",
            amount="5",
            receipts=[receipt_file()],
        )
        receipt = Receipt.objects.get()
        response = APIClient().get(f"/api/ledger/receipts/{receipt.pk}/file/")
        assert response.status_code in (401, 403)
        assert not ReceiptAccess.objects.exists()

    def test_posted_transactions_cannot_be_changed_through_the_api(
        self, members, client_for
    ):
        client = client_for(members["bob"])
        tx = post_intent(client, intent="top_up", amount="5").data
        url = f"{TRANSACTIONS}{tx['id']}/"
        responses = [
            client.patch(url, {"description": "x"}),
            client.put(url, {"description": "x"}),
            client.delete(url),
        ]
        assert {r.status_code for r in responses} == {
            status.HTTP_405_METHOD_NOT_ALLOWED
        }

    def test_feed_filters(self, members, client_for, category):
        bob, carla = members["bob"], members["carla"]
        top_up = post_intent(
            client_for(bob), intent="top_up", amount="5", receipts=[receipt_file()]
        ).data
        expense = post_intent(
            client_for(carla),
            intent="expense_for_community",
            amount="7",
            category=category("food").pk,
            description="Pasta for Thursday dinner",
        ).data
        client = client_for(bob)

        def ids(**params):
            return [
                row["id"] for row in client.get(TRANSACTIONS, params).data["results"]
            ]

        assert ids() == [expense["id"], top_up["id"]]
        assert ids(member=bob.owner.pk) == [top_up["id"]]
        assert ids(account=carla.pk) == [expense["id"]]
        assert ids(kind="top_up") == [top_up["id"]]
        assert ids(category=category("food").pk) == [expense["id"]]
        assert ids(has_receipt="true") == [top_up["id"]]
        assert ids(has_receipt="false") == [expense["id"]]
        assert ids(q="thursday") == [expense["id"]]
        assert ids(date_from="2999-01-01") == []

    def test_member_balances_are_public(self, members, client_for):
        post_intent(client_for(members["bob"]), intent="top_up", amount="5")

        rows = client_for(members["alice"]).get(ACCOUNTS, {"type": "member"}).data
        balances = {row["name"]: row["balance"] for row in rows["results"]}
        assert balances == {
            "Alice": "0.00",
            "Bob": "5.00",
            "Carla": "0.00",
            "Dan": "0.00",
        }

    def test_detail_shows_both_sides(self, members, client_for):
        tx = post_intent(
            client_for(members["bob"]),
            intent="member_to_member",
            amount="20",
            counterparty=members["carla"].pk,
        ).data
        detail = client_for(members["alice"]).get(f"{TRANSACTIONS}{tx['id']}/").data

        sides = {e["account"]["name"]: e["display_amount"] for e in detail["entries"]}
        assert sides == {"Bob": "-20.00", "Carla": "20.00"}
        assert detail["kind"] == "member_transfer"
        assert detail["category"]["code"] == "member-transfer"

    def test_health(self, members, client_for):
        post_intent(client_for(members["bob"]), intent="top_up", amount="5")
        health = client_for(members["bob"]).get("/api/ledger/health/").data
        assert health == {
            "ok": True,
            "trial_balance": "0.00",
            "mismatched_accounts": 0,
            "chain_ok": None,  # no digest yet
            "chain_checked_at": None,
        }

    def test_categories_and_projects(self, members, client_for):
        client = client_for(members["bob"])
        expense_codes = {
            c["code"] for c in client.get("/api/ledger/categories/?kind=expense").data
        }
        assert {"tools", "food"} <= expense_codes
        assert "donation" not in expense_codes
        assert client.get("/api/ledger/projects/").data == []


def test_member_account_is_opened_on_first_request(db):
    from bubble.users.tests.factories import UserFactory

    user = UserFactory()
    client = APIClient()
    client.force_authenticate(user)
    me = client.get(f"{ACCOUNTS}me/").data
    assert me["id"] == str(get_member_account(user).pk)
