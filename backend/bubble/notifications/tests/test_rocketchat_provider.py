from unittest.mock import Mock, patch

import pytest
from constance.test import override_config

from bubble.notifications.models import EventType
from bubble.notifications.providers.rocketchat import RocketChatProvider


@pytest.mark.django_db
def test_format_message_uses_new_message_template() -> None:
    provider = RocketChatProvider()

    response = Mock()
    response.text = "ok"
    response.raise_for_status.return_value = None

    with (
        override_config(
            ROCKETCHAT_WEBHOOK_URL="https://example.test/webhook",
            ROCKETCHAT_USER_UNDERSCORES=False,
        ),
        patch("bubble.notifications.providers.rocketchat.httpx.post") as post_mock,
    ):
        post_mock.return_value = response
        provider.send(
            EventType.NEW_MESSAGE,
            {
                "sender": "Alice",
                "item_title": "Tent",
                "message": "Hi there",
            },
            user_id="alice",
        )

    payload = post_mock.call_args.kwargs["json"]
    text = payload["text"]

    assert "Alice" in text
    assert "Tent" in text
    assert "Hi there" in text


@pytest.mark.django_db
def test_build_channel_payload_uses_new_item_payload() -> None:
    provider = RocketChatProvider()

    response = Mock()
    response.text = "ok"
    response.raise_for_status.return_value = None

    with (
        override_config(
            ROCKETCHAT_WEBHOOK_URL="https://example.test/webhook",
            ROCKETCHAT_CHANNEL="#general",
        ),
        patch("bubble.notifications.providers.rocketchat.httpx.post") as post_mock,
    ):
        post_mock.return_value = response
        provider.send(
            EventType.NEW_ITEM,
            {
                "name": "Camera",
                "description": "Mirrorless",
                "sales_type": "sell",
                "item_id": "123",
                "image_url": "",
            },
        )

    payload = post_mock.call_args.kwargs["json"]

    assert payload["text"]
    assert payload["attachments"][0]["title"] == "Camera"
