"""Bookings charge the ledger (plan section 6, D14-D18).

Rentals are charged when they complete. Sales change hands when the seller
accepts, and are charged when the buyer approves the hand-over; a buyer who
rejects it pays nothing and the item goes back to the seller.
"""

from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from constance.test import override_config
from django.contrib.auth.models import Group
from django.utils import timezone
from moneyed import Money
from rest_framework import status
from rest_framework.test import APIClient

from bubble.bookings.models import (
    Booking,
    BookingLedgerState,
    BookingStatus,
    Message,
)
from bubble.bookings.services import (
    complete_rental,
    reconcile_booking_charges,
    remind_or_auto_approve_sales,
)
from bubble.bookings.tests.factories import BookingFactory, ItemFactory
from bubble.core.permissions_config import DefaultGroup
from bubble.federation.models import AllowlistState, RemoteActor, RemoteInstance
from bubble.items.models import ItemStatus, LedgerBeneficiary, SalesType
from bubble.ledger.intents import LEDGER_ADMIN_GROUP
from bubble.ledger.models import Transaction, TransactionKind
from bubble.ledger.services import get_member_account, get_system_account
from bubble.users.tests.factories import UserFactory

BOOKINGS = "/api/bookings/"


def balance(account):
    account.balance.refresh_from_db()
    return account.balance.display_balance


def member_balance(user):
    return balance(get_member_account(user))


def charges():
    return Transaction.objects.filter(kind=TransactionKind.BOOKING_CHARGE)


@pytest.fixture
def people(db):
    group, _ = Group.objects.get_or_create(name=DefaultGroup.DEFAULT)
    users = {
        name: UserFactory(username=name, name=name.title())
        for name in ["seller", "buyer", "other"]
    }
    for user in users.values():
        user.groups.add(group)
    return users


@pytest.fixture
def api():
    def _client(user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    return _client


@pytest.fixture
def sale(people):
    """A pending request by the buyer for a 50 € item with payments on."""

    def _sale(**item_kwargs):
        defaults = {
            "user": people["seller"],
            "sales_type": SalesType.SELL,
            "price": "50.00",
            "payment_enabled": True,
        }
        item = ItemFactory(**{**defaults, **item_kwargs})
        return BookingFactory(user=people["buyer"], item=item, time_to=None)

    return _sale


def accept(api, people, booking):
    response = api(people["seller"]).patch(
        f"{BOOKINGS}{booking.id}/",
        {"status": BookingStatus.CONFIRMED},
        format="json",
    )
    assert response.status_code == status.HTTP_200_OK, response.data
    booking.refresh_from_db()
    return booking


class TestAcceptingASale:
    def test_the_item_changes_hands_and_nothing_is_charged_yet(self, api, people, sale):
        booking = accept(api, people, sale())
        item = booking.item
        item.refresh_from_db()

        assert item.user == people["buyer"]
        assert item.status == ItemStatus.DRAFT
        assert booking.seller == people["seller"]
        assert booking.agreed_price == Money("50.00", "EUR")
        assert booking.ledger_state == BookingLedgerState.PENDING
        assert not charges().exists()

    def test_the_seller_keeps_access_to_the_booking(self, api, people, sale):
        booking = accept(api, people, sale())

        response = api(people["seller"]).get(f"{BOOKINGS}{booking.id}/")

        assert response.status_code == status.HTTP_200_OK
        assert response.data["seller"] == people["seller"].pk
        assert response.data["ledger_state"] == "pending"

    def test_other_pending_requests_are_turned_down(self, api, people, sale):
        booking = sale()
        other = BookingFactory(user=people["other"], item=booking.item, time_to=None)

        accept(api, people, booking)

        other.refresh_from_db()
        assert other.status == BookingStatus.REJECTED
        assert Message.objects.filter(booking=other).exists()

    def test_a_self_service_sale_is_accepted_on_request(self, api, people):
        item = ItemFactory(
            user=people["seller"],
            sales_type=SalesType.SELL,
            price="20.00",
            payment_enabled=True,
            rental_self_service=True,
        )

        response = api(people["buyer"]).post(
            BOOKINGS, {"item": str(item.id)}, format="json"
        )

        assert response.status_code == status.HTTP_201_CREATED, response.data
        item.refresh_from_db()
        assert item.user == people["buyer"]
        assert Booking.objects.get(pk=response.data["id"]).ledger_state == "pending"

    def test_the_owner_booking_their_own_item_changes_nothing(self, people):
        item = ItemFactory(
            user=people["seller"], sales_type=SalesType.SELL, payment_enabled=True
        )
        client = APIClient()
        client.force_authenticate(people["seller"])

        response = client.post(BOOKINGS, {"item": str(item.id)}, format="json")

        assert response.status_code == status.HTTP_201_CREATED, response.data
        item.refresh_from_db()
        assert item.user == people["seller"]
        assert Booking.objects.get(pk=response.data["id"]).seller is None


class TestTheBuyerApproves:
    def test_the_frozen_amount_is_charged(self, api, people, sale):
        booking = accept(api, people, sale())
        # The buyer owns the item now; a new price must not change the deal.
        item = booking.item
        item.price = Money("1.00", "EUR")
        item.save()

        response = api(people["buyer"]).post(
            f"{BOOKINGS}{booking.id}/confirm_received/"
        )

        assert response.status_code == status.HTTP_200_OK, response.data
        assert response.data["status"] == BookingStatus.COMPLETED
        assert response.data["ledger_state"] == "posted"
        tx = charges().get()
        assert response.data["ledger_transaction"] == str(tx.id)
        assert tx.idempotency_key == f"booking:{booking.id}:charge"
        assert tx.category.code == "sale"
        assert member_balance(people["buyer"]) == Decimal("-50.00")
        assert member_balance(people["seller"]) == Decimal("50.00")

    def test_an_agreed_counter_offer_wins(self, api, people, sale):
        booking = sale()
        booking.counter_offer = Money("40.00", "EUR")
        booking.save()
        accept(api, people, booking)

        api(people["buyer"]).post(f"{BOOKINGS}{booking.id}/confirm_received/")

        assert member_balance(people["seller"]) == Decimal("40.00")

    def test_a_community_item_credits_the_community(self, api, people, sale):
        booking = accept(
            api, people, sale(ledger_beneficiary=LedgerBeneficiary.COMMUNITY)
        )
        booking.item.refresh_from_db()
        assert booking.item.ledger_beneficiary == LedgerBeneficiary.OWNER

        api(people["buyer"]).post(f"{BOOKINGS}{booking.id}/confirm_received/")

        assert member_balance(people["seller"]) == 0
        assert balance(get_system_account("income:sales")) == Decimal("50.00")

    def test_payments_off_means_no_charge(self, api, people, sale):
        booking = accept(api, people, sale(payment_enabled=False))
        assert booking.ledger_state == BookingLedgerState.NOT_CHARGED

        api(people["buyer"]).post(f"{BOOKINGS}{booking.id}/confirm_received/")

        booking.refresh_from_db()
        assert booking.status == BookingStatus.COMPLETED
        assert not charges().exists()

    def test_donations_never_charge(self, api, people, sale):
        booking = accept(api, people, sale(sales_type=SalesType.DONATE, price=None))

        api(people["buyer"]).post(f"{BOOKINGS}{booking.id}/confirm_received/")

        booking.refresh_from_db()
        assert booking.ledger_note == "Donation."
        assert not charges().exists()


class TestTheBuyerRejects:
    def test_the_sale_is_cancelled_free_and_the_item_goes_back(self, api, people, sale):
        booking = accept(api, people, sale())

        response = api(people["buyer"]).post(
            f"{BOOKINGS}{booking.id}/reject_fulfillment/",
            {"reason": "Never handed over"},
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK, response.data
        booking.refresh_from_db()
        item = booking.item
        item.refresh_from_db()
        assert booking.status == BookingStatus.CANCELLED
        assert booking.ledger_state == BookingLedgerState.NOT_CHARGED
        assert item.user == people["seller"]
        assert item.status == ItemStatus.DRAFT
        assert not charges().exists()
        assert Message.objects.filter(
            booking=booking, message__contains="Never handed over"
        ).exists()

    def test_a_community_item_goes_back_to_the_community(self, api, people, sale):
        booking = accept(
            api, people, sale(ledger_beneficiary=LedgerBeneficiary.COMMUNITY)
        )

        api(people["buyer"]).post(
            f"{BOOKINGS}{booking.id}/reject_fulfillment/",
            {"reason": "Broken"},
            format="json",
        )

        booking.item.refresh_from_db()
        assert booking.item.ledger_beneficiary == LedgerBeneficiary.COMMUNITY

    def test_only_the_buyer_can_reject_and_needs_a_reason(self, api, people, sale):
        booking = accept(api, people, sale())
        url = f"{BOOKINGS}{booking.id}/reject_fulfillment/"

        by_seller = api(people["seller"]).post(url, {"reason": "x"}, format="json")
        no_reason = api(people["buyer"]).post(url, {}, format="json")

        assert by_seller.status_code == status.HTTP_403_FORBIDDEN
        assert no_reason.status_code == status.HTTP_400_BAD_REQUEST

    def test_not_after_the_item_was_passed_on(self, api, people, sale):
        booking = accept(api, people, sale())
        # An open-ended sale booking blocks every other confirmed booking of
        # the item; a sale with an end time does not.
        now = timezone.now()
        Booking.objects.filter(pk=booking.pk).update(time_to=now + timedelta(hours=1))
        BookingFactory(
            user=people["other"],
            item=booking.item,
            status=BookingStatus.CONFIRMED,
            time_from=now + timedelta(hours=2),
            time_to=now + timedelta(hours=3),
        )

        response = api(people["buyer"]).post(
            f"{BOOKINGS}{booking.id}/reject_fulfillment/",
            {"reason": "Changed my mind"},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        booking.refresh_from_db()
        assert booking.status == BookingStatus.CONFIRMED

    def test_only_accepted_sales_can_be_rejected(self, api, people, sale):
        booking = sale()

        response = api(people["buyer"]).post(
            f"{BOOKINGS}{booking.id}/reject_fulfillment/",
            {"reason": "x"},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST


class TestNobodyCancelsAnAcceptedSale:
    @pytest.mark.parametrize("who", ["seller", "buyer"])
    def test_status_changes_are_refused(self, api, people, sale, who):
        booking = accept(api, people, sale())

        response = api(people[who]).patch(
            f"{BOOKINGS}{booking.id}/",
            {"status": BookingStatus.CANCELLED},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        booking.refresh_from_db()
        assert booking.status == BookingStatus.CONFIRMED

    def test_sales_accepted_before_the_ledger_keep_the_old_flow(
        self, api, people, sale
    ):
        booking = sale()
        booking.status = BookingStatus.CONFIRMED
        booking.save()  # no seller recorded: accepted before phase 3

        response = api(people["buyer"]).post(
            f"{BOOKINGS}{booking.id}/confirm_received/"
        )

        assert response.status_code == status.HTTP_200_OK
        booking.item.refresh_from_db()
        assert booking.item.user == people["buyer"]
        assert not charges().exists()


@pytest.fixture
def notices(monkeypatch):
    sent = []
    monkeypatch.setattr(
        "bubble.ledger.notify.dispatch_notification",
        lambda user, event_type, context: sent.append((user.username, context)),
    )
    monkeypatch.setattr(
        "bubble.ledger.notify.send_message_notification",
        lambda user_id, message: None,
    )
    return sent


class TestTheBuyerDoesNotAnswer:
    """D19: a daily reminder, then approval and the charge after 3 days."""

    def test_reminded_daily_then_approved_and_charged(
        self, api, people, sale, notices, django_capture_on_commit_callbacks
    ):
        booking = accept(api, people, sale())
        accepted = booking.sale_accepted_at
        deadline = accepted + timedelta(days=3)
        response = api(people["buyer"]).get(f"{BOOKINGS}{booking.id}/")
        shown = datetime.fromisoformat(response.data["sale_auto_approve_at"])
        assert shown == deadline

        with django_capture_on_commit_callbacks(execute=True):
            # Not yet a day: nothing.
            assert remind_or_auto_approve_sales(accepted + timedelta(hours=23)) == (
                0,
                0,
            )
            # One reminder a day, however often the job runs.
            for hours, expected in [(24, (1, 0)), (25, (0, 0)), (47, (0, 0))]:
                assert (
                    remind_or_auto_approve_sales(accepted + timedelta(hours=hours))
                    == expected
                )
            assert remind_or_auto_approve_sales(accepted + timedelta(hours=48)) == (
                1,
                0,
            )
        assert [(user, c["kind"]) for user, c in notices] == [
            ("buyer", "sale_reminder"),
            ("buyer", "sale_reminder"),
        ]
        assert notices[0][1]["amount"] == "50.00 EUR"
        assert notices[0][1]["deadline"] == str(timezone.localdate(deadline))
        assert not charges().exists()

        notices.clear()
        with django_capture_on_commit_callbacks(execute=True):
            assert remind_or_auto_approve_sales(deadline + timedelta(minutes=5)) == (
                0,
                1,
            )

        booking.refresh_from_db()
        assert booking.status == BookingStatus.COMPLETED
        assert booking.ledger_state == BookingLedgerState.POSTED
        assert member_balance(people["buyer"]) == Decimal("-50.00")
        assert member_balance(people["seller"]) == Decimal("50.00")
        assert Message.objects.filter(
            booking=booking, message__contains="automatically"
        ).exists()
        kinds = {(user, c["kind"]) for user, c in notices}
        assert ("buyer", "sale_auto_approved") in kinds
        assert ("seller", "sale_auto_approved") in kinds
        # Idempotent: a second run charges nothing more.
        assert remind_or_auto_approve_sales(deadline + timedelta(hours=2)) == (0, 0)
        assert charges().count() == 1

    def test_the_setting_moves_the_deadline(self, api, people, sale):
        booking = accept(api, people, sale())
        with override_config(SALE_AUTO_APPROVE_DAYS=1):
            assert remind_or_auto_approve_sales(
                booking.sale_accepted_at + timedelta(days=1, minutes=1)
            ) == (0, 1)

    def test_an_answered_sale_is_left_alone(self, api, people, sale):
        booking = accept(api, people, sale())
        api(people["buyer"]).post(
            f"{BOOKINGS}{booking.id}/reject_fulfillment/",
            {"reason": "Broken"},
            format="json",
        )
        later = booking.sale_accepted_at + timedelta(days=5)
        assert remind_or_auto_approve_sales(later) == (0, 0)
        assert not charges().exists()

    def test_legacy_and_unaccepted_sales_are_not_touched(self, api, people, sale):
        legacy = sale()
        legacy.status = BookingStatus.CONFIRMED
        legacy.save()
        sale()  # still pending
        later = timezone.now() + timedelta(days=5)
        assert remind_or_auto_approve_sales(later) == (0, 0)
        legacy.refresh_from_db()
        assert legacy.status == BookingStatus.CONFIRMED


@pytest.fixture
def rental(people):
    """A confirmed two-day rental at 10 € a day, payments on."""

    def _rental(**item_kwargs):
        defaults = {
            "user": people["seller"],
            "sales_type": SalesType.RENT,
            "price": "10.00",
            "rental_period": "d",
            "payment_enabled": True,
            "rental_open_end": True,
        }
        item = ItemFactory(**{**defaults, **item_kwargs})
        start = timezone.now() - timedelta(days=2)
        return BookingFactory(
            user=people["buyer"],
            item=item,
            status=BookingStatus.IN_PROGRESS,
            time_from=start,
            time_to=start + timedelta(days=2),
        )

    return _rental


def return_rental(api, people, booking):
    response = api(people["seller"]).post(f"{BOOKINGS}{booking.id}/confirm_returned/")
    assert response.status_code == status.HTTP_200_OK, response.data
    booking.refresh_from_db()
    return booking


class TestRentals:
    def test_a_completed_rental_charges_the_booker(self, api, people, rental):
        booking = return_rental(api, people, rental())

        assert booking.ledger_state == BookingLedgerState.POSTED
        assert booking.agreed_price == Money("20.00", "EUR")
        tx = charges().get()
        assert tx.category.code == "rental"
        assert member_balance(people["buyer"]) == Decimal("-20.00")
        assert member_balance(people["seller"]) == Decimal("20.00")

    def test_a_community_item_credits_rental_income(self, api, people, rental):
        return_rental(
            api, people, rental(ledger_beneficiary=LedgerBeneficiary.COMMUNITY)
        )

        assert balance(get_system_account("income:rental")) == Decimal("20.00")
        assert member_balance(people["seller"]) == 0

    def test_payments_off_means_no_charge(self, api, people, rental):
        booking = return_rental(api, people, rental(payment_enabled=False))

        assert booking.ledger_state == BookingLedgerState.NOT_CHARGED
        assert not charges().exists()

    def test_an_open_ended_rental_is_priced_up_to_the_return(self, api, people, rental):
        booking = rental()
        booking.time_from = timezone.now() - timedelta(days=3)
        booking.time_to = None
        booking.save()

        booking = return_rental(api, people, booking)

        assert booking.agreed_price == Money("30.00", "EUR")

    def test_a_charge_posts_once(self, api, people, rental):
        booking = return_rental(api, people, rental())

        assert complete_rental(booking) is None
        assert charges().count() == 1

    def test_ending_a_self_service_rental_charges_it(self, api, people):
        item = ItemFactory(
            user=people["seller"],
            sales_type=SalesType.RENT,
            price="5.00",
            rental_period="h",
            payment_enabled=True,
            rental_self_service=True,
        )
        now = timezone.now()
        booking = BookingFactory(
            user=people["buyer"],
            item=item,
            status=BookingStatus.CONFIRMED,
            time_from=now - timedelta(hours=2),
            time_to=now,
        )

        response = api(people["seller"]).patch(
            f"{BOOKINGS}{booking.id}/",
            {"status": BookingStatus.COMPLETED},
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK, response.data
        assert member_balance(people["buyer"]) == Decimal("-10.00")


class TestUnbilled:
    def test_a_foreign_currency_price_is_unbilled(self, api, people, rental):
        booking = rental(price=Money("10.00", "USD"))
        booking = return_rental(api, people, booking)

        assert booking.ledger_state == BookingLedgerState.UNBILLED
        assert "USD" in booking.ledger_note
        assert not charges().exists()

    def test_a_remote_booker_is_unbilled(self, people, rental):
        instance = RemoteInstance.objects.create(
            domain="peer.example",
            allowlist_state=AllowlistState.ALLOWED,
            inbox_url="https://peer.example/federation/inbox",
        )
        actor = RemoteActor.objects.create(
            instance=instance,
            ap_id="https://peer.example/federation/users/remy",
            preferred_username="remy",
            name="Remy",
            inbox_url="https://peer.example/federation/users/remy/inbox",
            public_key_pem="",
        )
        booking = rental()
        booking.user = None
        booking.remote_booker_actor = actor
        booking.status = BookingStatus.COMPLETED
        booking.save()

        complete_rental(booking)

        assert booking.ledger_state == BookingLedgerState.UNBILLED
        assert booking.ledger_note == "The booker is on another instance."

    def test_the_treasurer_sees_the_unbilled_list(self, api, people, rental):
        return_rental(api, people, rental(price=Money("10.00", "USD")))
        treasurer = people["other"]
        treasurer.groups.add(Group.objects.get_or_create(name=LEDGER_ADMIN_GROUP)[0])

        listed = api(treasurer).get("/api/ledger/unbilled/")
        refused = api(people["buyer"]).get("/api/ledger/unbilled/")

        assert listed.status_code == status.HTTP_200_OK
        assert [row["booker"] for row in listed.data] == ["Buyer"]
        assert listed.data[0]["currency"] == "USD"
        assert refused.status_code == status.HTTP_403_FORBIDDEN


class TestReconciliation:
    def test_clean_after_charges(self, api, people, rental):
        return_rental(api, people, rental())

        report = reconcile_booking_charges()

        assert report.ok
        assert report.unbilled == 0

    def test_finds_a_charged_booking_without_a_charge(self, people, rental):
        booking = rental()
        Booking.objects.filter(pk=booking.pk).update(
            ledger_state=BookingLedgerState.POSTED
        )

        report = reconcile_booking_charges()

        assert report.missing_charges == [str(booking.pk)]
        assert not report.ok

    def test_lists_sales_waiting_for_the_buyer(self, api, people, sale):
        booking = accept(api, people, sale())
        Booking.objects.filter(pk=booking.pk).update(
            sale_accepted_at=timezone.now() - timedelta(days=15)
        )

        assert reconcile_booking_charges().waiting_sales == [str(booking.pk)]


class TestItemSettings:
    def test_owners_switch_payments_but_not_community_ownership(self, api, people):
        item = ItemFactory(user=people["seller"])

        response = api(people["seller"]).patch(
            f"/api/items/{item.id}/",
            {"payment_enabled": True, "ledger_beneficiary": "community"},
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK, response.data
        item.refresh_from_db()
        assert item.payment_enabled is True
        assert item.ledger_beneficiary == LedgerBeneficiary.OWNER
