"""Fan-out, pruning and payload shape of the web push delivery task."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from django.test import override_settings

from bubble.notifications import webpush
from bubble.notifications.dispatch import dispatch_notification
from bubble.notifications.messages import TEST_EVENT_TYPE
from bubble.notifications.models import (
    EventType,
    NotificationPreference,
    PushSubscription,
)
from bubble.notifications.providers.webpush_provider import PushResult
from bubble.notifications.tasks import deliver_web_push
from bubble.users.tests.factories import UserFactory

ProviderType = NotificationPreference.ProviderType

PRIVATE_KEY, PUBLIC_KEY = webpush.generate_keys()

configured = override_settings(
    VAPID_PUBLIC_KEY=PUBLIC_KEY,
    VAPID_PRIVATE_KEY=PRIVATE_KEY,
    VAPID_SUBJECT="mailto:admin@example.org",
)

DELIVERED = PushResult(delivered=True)
GONE = PushResult(delivered=False, expired=True)
FAILED = PushResult(delivered=False)


def _subscription(user, suffix: str) -> PushSubscription:
    return PushSubscription.objects.create(
        user=user,
        endpoint=f"https://push.example.com/v1/{suffix}",
        p256dh=f"p256dh-{suffix}",
        auth=f"auth-{suffix}",
    )


def _enable_webpush(user, event_type: str) -> None:
    NotificationPreference.objects.update_or_create(
        user=user,
        provider_type=ProviderType.WEBPUSH,
        event_type=event_type,
        defaults={"enabled": True},
    )


@configured
@pytest.mark.django_db
def test_delivers_to_every_device_of_the_user() -> None:
    user = UserFactory()
    _subscription(user, "one")
    _subscription(user, "two")
    # Another user's device must not receive this.
    _subscription(UserFactory(), "other")

    with patch(
        "bubble.notifications.tasks.send_web_push", return_value=DELIVERED
    ) as mocked:
        deliver_web_push.call_local(user.pk, EventType.NEW_MESSAGE, {"message": "hi"})

    endpoints = {call.args[0]["endpoint"] for call in mocked.call_args_list}
    assert endpoints == {
        "https://push.example.com/v1/one",
        "https://push.example.com/v1/two",
    }


@configured
@pytest.mark.django_db
def test_payload_carries_title_body_and_click_target() -> None:
    user = UserFactory()
    _subscription(user, "one")
    booking_id = "11111111-1111-1111-1111-111111111111"

    with patch(
        "bubble.notifications.tasks.send_web_push", return_value=DELIVERED
    ) as mocked:
        deliver_web_push.call_local(
            user.pk,
            EventType.NEW_MESSAGE,
            {
                "message": "Is the drill free?",
                "item_title": "Drill",
                "sender": "alice",
                "booking_id": booking_id,
            },
        )

    payload = mocked.call_args.args[1]
    assert payload["title"] == "New message"
    assert "Is the drill free?" in payload["body"]
    # The service worker opens this on click, so it has to be the conversation.
    assert payload["url"] == f"/bookings/{booking_id}"
    assert payload["event_type"] == EventType.NEW_MESSAGE
    assert booking_id in payload["tag"]


@configured
@pytest.mark.django_db
def test_test_event_renders_its_own_copy() -> None:
    user = UserFactory()
    _subscription(user, "one")

    with patch(
        "bubble.notifications.tasks.send_web_push", return_value=DELIVERED
    ) as mocked:
        deliver_web_push.call_local(user.pk, TEST_EVENT_TYPE, {})

    payload = mocked.call_args.args[1]
    assert payload["title"] == "Bubble"
    assert "working" in payload["body"]
    assert payload["url"] == "/"


@configured
@pytest.mark.django_db
def test_expired_subscriptions_are_deleted_and_others_kept() -> None:
    user = UserFactory()
    gone = _subscription(user, "gone")
    alive = _subscription(user, "alive")

    def fake_send(subscription_info, _payload):
        return GONE if subscription_info["endpoint"] == gone.endpoint else DELIVERED

    with patch("bubble.notifications.tasks.send_web_push", side_effect=fake_send):
        deliver_web_push.call_local(
            user.pk, EventType.NEW_BOOKING, {"item_title": "Drill"}
        )

    assert not PushSubscription.objects.filter(pk=gone.pk).exists()
    alive.refresh_from_db()
    assert alive.last_used_at is not None


@configured
@pytest.mark.django_db
def test_only_delivered_devices_are_marked_as_used() -> None:
    """A flaky endpoint must not look healthy just because a sibling worked."""
    user = UserFactory()
    good = _subscription(user, "good")
    flaky = _subscription(user, "flaky")
    gone = _subscription(user, "gone")

    outcomes = {
        good.endpoint: DELIVERED,
        flaky.endpoint: FAILED,
        gone.endpoint: GONE,
    }

    with patch(
        "bubble.notifications.tasks.send_web_push",
        side_effect=lambda info, _payload: outcomes[info["endpoint"]],
    ):
        deliver_web_push.call_local(user.pk, EventType.NEW_MESSAGE, {"message": "hi"})

    good.refresh_from_db()
    flaky.refresh_from_db()
    assert good.last_used_at is not None
    assert flaky.last_used_at is None
    assert not PushSubscription.objects.filter(pk=gone.pk).exists()


@configured
@pytest.mark.django_db
def test_transient_failures_keep_the_subscription() -> None:
    user = UserFactory()
    subscription = _subscription(user, "flaky")

    with patch("bubble.notifications.tasks.send_web_push", return_value=FAILED):
        deliver_web_push.call_local(user.pk, EventType.NEW_MESSAGE, {"message": "hi"})

    subscription.refresh_from_db()
    assert PushSubscription.objects.filter(pk=subscription.pk).exists()
    # Nothing arrived, so the "last used" marker must not move.
    assert subscription.last_used_at is None


@configured
@pytest.mark.django_db
def test_no_devices_is_a_no_op() -> None:
    user = UserFactory()

    with patch("bubble.notifications.tasks.send_web_push") as mocked:
        deliver_web_push.call_local(user.pk, EventType.NEW_MESSAGE, {"message": "hi"})

    mocked.assert_not_called()


@configured
@pytest.mark.django_db
def test_dispatch_routes_an_enabled_preference_to_the_push_task() -> None:
    user = UserFactory()
    _subscription(user, "one")
    _enable_webpush(user, EventType.NEW_MESSAGE)

    with (
        patch("bubble.notifications.dispatch.deliver_web_push") as mocked_push,
        patch("bubble.notifications.dispatch.deliver_notification") as mocked_apprise,
    ):
        dispatch_notification(user, EventType.NEW_MESSAGE, {"message": "hi"})

    mocked_push.assert_called_once_with(
        user.pk, EventType.NEW_MESSAGE, {"message": "hi"}, language=None
    )
    # Web push must not be pushed through the Apprise path, which would try to
    # build an Apprise URL for a channel that has none.
    mocked_apprise.assert_not_called()


@override_settings(VAPID_PUBLIC_KEY="", VAPID_PRIVATE_KEY="", VAPID_SUBJECT="")
@pytest.mark.django_db
def test_dispatch_skips_push_when_the_backend_has_no_keys() -> None:
    user = UserFactory()
    _subscription(user, "one")
    _enable_webpush(user, EventType.NEW_MESSAGE)

    with patch("bubble.notifications.dispatch.deliver_web_push") as mocked_push:
        dispatch_notification(user, EventType.NEW_MESSAGE, {"message": "hi"})

    mocked_push.assert_not_called()


@configured
@pytest.mark.django_db
def test_dispatch_ignores_a_disabled_preference() -> None:
    user = UserFactory()
    _subscription(user, "one")
    NotificationPreference.objects.update_or_create(
        user=user,
        provider_type=ProviderType.WEBPUSH,
        event_type=EventType.NEW_MESSAGE,
        defaults={"enabled": False},
    )

    with patch("bubble.notifications.dispatch.deliver_web_push") as mocked_push:
        dispatch_notification(user, EventType.NEW_MESSAGE, {"message": "hi"})

    mocked_push.assert_not_called()
