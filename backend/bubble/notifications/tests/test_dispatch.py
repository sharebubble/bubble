from unittest.mock import patch

import pytest
from constance.test import override_config

from bubble.notifications.dispatch import (
    dispatch_item_created,
    dispatch_notification,
)
from bubble.notifications.models import EventType, NotificationPreference
from bubble.users.tests.factories import UserFactory

ROCKET_URL = "rocket://user:pass@chat.example.com/{target}"


@pytest.mark.django_db
@override_config(APPRISE_ROCKETCHAT_URL=ROCKET_URL)
def test_dispatch_notification_enqueues_enabled_preferences() -> None:
    user = UserFactory(username="alice")
    NotificationPreference.objects.update_or_create(
        user=user,
        provider_type=NotificationPreference.ProviderType.ROCKETCHAT,
        event_type=EventType.NEW_MESSAGE,
        defaults={"enabled": True},
    )

    with patch("bubble.notifications.dispatch.deliver_notification") as mocked_deliver:
        dispatch_notification(
            user=user,
            event_type=EventType.NEW_MESSAGE,
            context={"message": "hello"},
        )

    mocked_deliver.assert_called_once_with(
        NotificationPreference.ProviderType.ROCKETCHAT,
        EventType.NEW_MESSAGE,
        {"message": "hello"},
        target="@alice",
        language=None,
    )


@pytest.mark.django_db
@override_config(APPRISE_ROCKETCHAT_URL=ROCKET_URL)
def test_dispatch_notification_skips_when_target_missing() -> None:
    user = UserFactory(username="")
    NotificationPreference.objects.update_or_create(
        user=user,
        provider_type=NotificationPreference.ProviderType.ROCKETCHAT,
        event_type=EventType.NEW_MESSAGE,
        defaults={"enabled": True},
    )

    with patch("bubble.notifications.dispatch.deliver_notification") as mocked_deliver:
        dispatch_notification(user, EventType.NEW_MESSAGE, {"message": "x"})

    mocked_deliver.assert_not_called()


@pytest.mark.django_db
@override_config(APPRISE_ROCKETCHAT_URL="")
def test_dispatch_notification_skips_when_backend_unconfigured() -> None:
    user = UserFactory(username="bob")
    NotificationPreference.objects.create(
        user=user,
        provider_type=NotificationPreference.ProviderType.ROCKETCHAT,
        event_type=EventType.NEW_MESSAGE,
        enabled=True,
    )

    with patch("bubble.notifications.dispatch.deliver_notification") as mocked_deliver:
        dispatch_notification(user, EventType.NEW_MESSAGE, {"message": "x"})

    mocked_deliver.assert_not_called()


@pytest.mark.django_db
@override_config(APPRISE_ROCKETCHAT_URL=ROCKET_URL)
def test_dispatch_item_created_notifies_each_subscriber() -> None:
    alice = UserFactory(username="alice")
    bob = UserFactory(username="bob")
    NotificationPreference.objects.create(
        user=alice,
        provider_type=NotificationPreference.ProviderType.ROCKETCHAT,
        event_type=EventType.NEW_ITEM,
        enabled=True,
    )
    NotificationPreference.objects.create(
        user=bob,
        provider_type=NotificationPreference.ProviderType.ROCKETCHAT,
        event_type=EventType.NEW_ITEM,
        enabled=False,
    )

    with patch("bubble.notifications.dispatch.deliver_notification") as mocked_deliver:
        dispatch_item_created({"name": "Bike"})

    mocked_deliver.assert_called_once_with(
        NotificationPreference.ProviderType.ROCKETCHAT,
        EventType.NEW_ITEM,
        {"name": "Bike"},
        target="@alice",
        language=None,
    )
