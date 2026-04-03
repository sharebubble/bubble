from unittest.mock import patch

import pytest

from bubble.notifications.models import EventType
from bubble.notifications.tasks import (
    deliver_channel_notification,
    deliver_notification,
)


@pytest.mark.django_db
def test_deliver_notification_unknown_provider_logs_warning() -> None:
    with patch("bubble.notifications.tasks.logger.warning") as warning_mock:
        deliver_notification.call_local(
            "unknown", EventType.NEW_MESSAGE, {"message": "x"}
        )

    warning_mock.assert_called_once()


@pytest.mark.django_db
def test_deliver_notification_calls_provider_send() -> None:
    provider = type("Provider", (), {"send": lambda *args, **kwargs: True})()
    with (
        patch.dict(
            "bubble.notifications.tasks._PROVIDERS",
            {"rocketchat": lambda: provider},
            clear=True,
        ),
        patch.object(provider, "send", return_value=True) as send_mock,
    ):
        deliver_notification.call_local(
            "rocketchat",
            EventType.NEW_MESSAGE,
            {"message": "hello"},
            user_id="alice",
        )

    send_mock.assert_called_once_with(
        EventType.NEW_MESSAGE,
        {"message": "hello"},
        user_id="alice",
    )


@pytest.mark.django_db
def test_deliver_channel_notification_calls_provider_send_channel() -> None:
    provider = type("Provider", (), {"send_channel": lambda *args, **kwargs: True})()
    with (
        patch.dict(
            "bubble.notifications.tasks._PROVIDERS",
            {"rocketchat": lambda: provider},
            clear=True,
        ),
        patch.object(provider, "send_channel", return_value=True) as send_mock,
    ):
        deliver_channel_notification.call_local(
            "rocketchat",
            EventType.NEW_ITEM,
            {"name": "Bike"},
        )

    send_mock.assert_called_once_with(EventType.NEW_ITEM, {"name": "Bike"})
