from unittest.mock import patch

import pytest
from constance.test import override_config

from bubble.notifications.models import EventType
from bubble.notifications.tasks import deliver_notification

ROCKET_URL = "rocket://user:pass@chat.example.com/@{target}"


@pytest.mark.django_db
@override_config(APPRISE_ROCKETCHAT_URL="")
def test_deliver_notification_skips_when_unconfigured() -> None:
    with patch("bubble.notifications.tasks.send_apprise_notification") as mocked_send:
        deliver_notification.call_local(
            "rocketchat",
            EventType.NEW_MESSAGE,
            {"message": "x"},
            target="alice",
        )

    mocked_send.assert_not_called()


@pytest.mark.django_db
@override_config(APPRISE_ROCKETCHAT_URL=ROCKET_URL)
def test_deliver_notification_skips_when_target_missing() -> None:
    with patch("bubble.notifications.tasks.send_apprise_notification") as mocked_send:
        deliver_notification.call_local(
            "rocketchat",
            EventType.NEW_MESSAGE,
            {"message": "x"},
            target="",
        )

    mocked_send.assert_not_called()


@pytest.mark.django_db
@override_config(APPRISE_ROCKETCHAT_URL=ROCKET_URL)
def test_deliver_notification_builds_url_and_sends() -> None:
    with patch(
        "bubble.notifications.tasks.send_apprise_notification",
        return_value=True,
    ) as mocked_send:
        deliver_notification.call_local(
            "rocketchat",
            EventType.NEW_MESSAGE,
            {"sender": "bob", "item_title": "Bike", "message": "Hi"},
            target="alice",
        )

    mocked_send.assert_called_once()
    url, title, body = mocked_send.call_args.args
    assert url == "rocket://user:pass@chat.example.com/@alice"
    assert title
    assert "bob" in body


@pytest.mark.django_db
@override_config(APPRISE_ROCKETCHAT_URL=ROCKET_URL)
def test_deliver_notification_swallows_provider_errors() -> None:
    with patch(
        "bubble.notifications.tasks.send_apprise_notification",
        side_effect=RuntimeError("boom"),
    ):
        # Should not raise.
        deliver_notification.call_local(
            "rocketchat",
            EventType.NEW_MESSAGE,
            {"message": "x"},
            target="alice",
        )
