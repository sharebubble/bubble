"""Tests for the WebSocket notification helpers."""

from unittest import mock

import msgpack
from django.test import SimpleTestCase
from django.utils.translation import gettext_lazy

from bubble.core.websocket_signals import (
    send_message_notification,
    send_user_notification,
)


class WebsocketNotificationTestCase(SimpleTestCase):
    def capture_payloads(self):
        """Patch the channel layer and return the list of sent payloads."""
        payloads = []

        async def fake_group_send(channel, payload):
            payloads.append(payload)

        layer = mock.MagicMock()
        layer.group_send = fake_group_send
        patcher = mock.patch(
            "bubble.core.websocket_signals.get_channel_layer", return_value=layer
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        return payloads

    def test_lazy_message_is_sent_as_plain_string(self):
        payloads = self.capture_payloads()

        send_message_notification(
            1,
            message=gettext_lazy("Item rented via QR code."),
            booking_uuid="a-booking-uuid",
        )

        # channels_redis serialises payloads with msgpack, which raises
        # ``TypeError: can not serialize '__proxy__' object`` for lazy strings.
        msgpack.packb(payloads[0])
        assert type(payloads[0]["data"]["data"]["message"]) is str
        assert type(payloads[0]["data"]["data"]["booking"]) is str

    def test_lazy_title_is_sent_as_plain_string(self):
        payloads = self.capture_payloads()

        send_user_notification(
            1,
            message=gettext_lazy("Hello"),
            title=gettext_lazy("Notification title"),
        )

        msgpack.packb(payloads[0])
        assert type(payloads[0]["data"]["data"]["message"]) is str
        assert type(payloads[0]["data"]["title"]) is str
