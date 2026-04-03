from unittest.mock import patch

import pytest

from bubble.notifications.dispatch import (
    dispatch_channel_notification,
    dispatch_notification,
)
from bubble.notifications.models import EventType, NotificationPreference
from bubble.users.tests.factories import UserFactory


@pytest.mark.django_db
def test_dispatch_notification_enqueues_enabled_preferences() -> None:
    user = UserFactory()
    NotificationPreference.objects.create(
        user=user,
        provider_type=NotificationPreference.ProviderType.ROCKETCHAT,
        event_type=EventType.NEW_MESSAGE,
        enabled=True,
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
        user_id=user.username,
    )


@pytest.mark.django_db
def test_dispatch_channel_notification_ignores_non_channel_event() -> None:
    with patch("bubble.notifications.dispatch.deliver_notification") as mocked_deliver:
        dispatch_channel_notification(EventType.NEW_MESSAGE, {"name": "ignored"})

    mocked_deliver.assert_not_called()


@pytest.mark.django_db
def test_dispatch_channel_notification_enqueues_for_all_providers() -> None:
    with patch("bubble.notifications.dispatch.deliver_notification") as mocked_deliver:
        dispatch_channel_notification(EventType.NEW_ITEM, {"name": "Item A"})

    expected_call_count = len(NotificationPreference.ProviderType)
    assert mocked_deliver.call_count == expected_call_count
