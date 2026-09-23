"""Ledger notices (plan section 10) and balance reminders (D10)."""

import importlib
from datetime import timedelta

import pytest
from django.apps import apps
from django.db import transaction
from django.utils import timezone

from bubble.ledger.models import TransactionKind
from bubble.ledger.notify import notify, notify_posting
from bubble.ledger.reminders import remind_low_balances
from bubble.notifications.messages import format_notification, notification_path
from bubble.notifications.models import EventType, NotificationPreference
from bubble.users.tests.factories import UserFactory


class TestNotices:
    def test_a_posting_tells_everyone_but_the_actor(
        self, members, post, notices, django_capture_on_commit_callbacks
    ):
        alice, bob = members["alice"], members["bob"]
        with django_capture_on_commit_callbacks(execute=True):
            tx = post(
                (bob, 15),
                (alice, -15),
                kind=TransactionKind.MEMBER_TRANSFER,
                description="Pizza",
                created_by=alice,
            )
            notify_posting(tx, actor=alice.owner)

        assert len(notices) == 1
        user, context = notices[0]
        assert user == bob.owner
        assert context == {
            "kind": "posted",
            "path": f"/ledger/t/{tx.pk}",
            "actor": "Alice",
            "description": "Pizza",
            "amount": "-15.00 EUR",
        }
        _title, body = format_notification(EventType.LEDGER, context)
        assert body == 'Alice booked "Pizza": your balance changes by -15.00 EUR.'
        assert notification_path(EventType.LEDGER, context) == f"/ledger/t/{tx.pk}"

    def test_credits_are_signed(
        self, members, post, notices, django_capture_on_commit_callbacks
    ):
        with django_capture_on_commit_callbacks(execute=True):
            tx = post((members["bob"], 15), (members["alice"], -15))
            notify_posting(tx)
        amounts = {u.username: c["amount"] for u, c in notices}
        assert amounts == {"alice": "+15.00 EUR", "bob": "-15.00 EUR"}
        assert {c["actor"] for _u, c in notices} == {"Bubble"}

    def test_nothing_is_announced_when_rolled_back(
        self, members, notices, django_capture_on_commit_callbacks
    ):
        def post_and_fail():
            with transaction.atomic():
                notify(members["bob"].owner, "soft_limit", amount="1", limit="2")
                raise RuntimeError

        with (
            django_capture_on_commit_callbacks(execute=True),
            pytest.raises(RuntimeError),
        ):
            post_and_fail()
        assert notices == []

    def test_inactive_members_are_not_told(
        self, members, notices, django_capture_on_commit_callbacks
    ):
        bob = members["bob"].owner
        bob.is_active = False
        bob.save()
        with django_capture_on_commit_callbacks(execute=True):
            notify(bob, "soft_limit", amount="1", limit="2")
        assert notices == []

    def test_an_unknown_kind_still_reads_well(self):
        _title, body = format_notification(EventType.LEDGER, {"kind": "new-thing"})
        assert body == "There is news in the community ledger."


class TestSoftLimitReminders:
    def test_weekly_while_below_and_again_after_recovering(
        self, members, post, notices, django_capture_on_commit_callbacks
    ):
        bob = members["bob"]
        now = timezone.now()
        post((bob, 120), ("asset:bank", -120))

        with django_capture_on_commit_callbacks(execute=True):
            assert remind_low_balances(now) == 1
            assert remind_low_balances(now + timedelta(days=3)) == 0
            assert remind_low_balances(now + timedelta(days=8)) == 1
        assert [
            (u.username, c["kind"], c["amount"], c["limit"]) for u, c in notices
        ] == [
            ("bob", "soft_limit", "-120.00 EUR", "-100.00 EUR"),
            ("bob", "soft_limit", "-120.00 EUR", "-100.00 EUR"),
        ]

        # Topped up: forgotten, so the next drop reminds straight away.
        post((bob, -50), ("asset:bank", 50))
        assert remind_low_balances(now + timedelta(days=9)) == 0
        bob.refresh_from_db()
        assert bob.soft_limit_reminded_at is None
        post((bob, 50), ("asset:bank", -50))
        assert remind_low_balances(now + timedelta(days=10)) == 1

    def test_members_above_the_limit_are_left_alone(self, members, post):
        post((members["bob"], 99), ("asset:bank", -99))
        assert remind_low_balances() == 0


@pytest.mark.django_db
def test_ledger_notices_follow_the_message_toggle():
    """Migration 0008: whoever gets message notices gets ledger notices too."""
    migration = importlib.import_module(
        "bubble.notifications.migrations.0008_ledger_event"
    )
    on, off = UserFactory(), UserFactory()
    for user, enabled in [(on, True), (off, False)]:
        NotificationPreference.objects.update_or_create(
            user=user,
            provider_type="email",
            event_type=EventType.NEW_MESSAGE,
            defaults={"enabled": enabled},
        )
    NotificationPreference.objects.filter(event_type=EventType.LEDGER).delete()

    migration.copy_message_preferences(apps, None)

    ledger = dict(
        NotificationPreference.objects.filter(
            event_type=EventType.LEDGER, provider_type="email"
        ).values_list("user", "enabled")
    )
    assert ledger == {on.pk: True, off.pk: False}
