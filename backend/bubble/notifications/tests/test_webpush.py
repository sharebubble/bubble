"""VAPID key handling and the availability rules that gate the push channel."""

from __future__ import annotations

import base64

import pytest
from django.test import override_settings

from bubble.notifications import webpush
from bubble.notifications.channels import is_backend_configured, is_channel_available
from bubble.notifications.models import NotificationPreference, PushSubscription
from bubble.users.tests.factories import UserFactory

ProviderType = NotificationPreference.ProviderType

# A throwaway keypair generated the same way generate_vapid_keys does.
PRIVATE_KEY, PUBLIC_KEY = webpush.generate_keys()

# Sizes fixed by P-256: a 32-byte private scalar and a 65-byte uncompressed
# point that starts with the 0x04 marker.
PRIVATE_SCALAR_BYTES = 32
UNCOMPRESSED_POINT_BYTES = 65
UNCOMPRESSED_POINT_MARKER = 0x04


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def test_generate_keys_returns_a_usable_p256_pair() -> None:
    private_key, public_key = webpush.generate_keys()

    # The raw scalar and the uncompressed point are what py_vapid and the browser
    # respectively expect; wrong lengths fail silently at send time.
    assert len(_b64url_decode(private_key)) == PRIVATE_SCALAR_BYTES
    public_raw = _b64url_decode(public_key)
    assert len(public_raw) == UNCOMPRESSED_POINT_BYTES
    assert public_raw[0] == UNCOMPRESSED_POINT_MARKER

    # base64url, unpadded — a "+" or "=" here breaks pushManager.subscribe().
    for key in (private_key, public_key):
        assert "=" not in key
        assert "+" not in key
        assert "/" not in key


def test_generate_keys_returns_a_new_pair_each_time() -> None:
    assert webpush.generate_keys()[0] != webpush.generate_keys()[0]


@override_settings(VAPID_PUBLIC_KEY="", VAPID_PRIVATE_KEY="", VAPID_SUBJECT="")
def test_is_configured_false_without_keys() -> None:
    assert webpush.is_configured() is False


@override_settings(
    VAPID_PUBLIC_KEY=PUBLIC_KEY,
    VAPID_PRIVATE_KEY="",
    VAPID_SUBJECT="mailto:a@b.example",
)
def test_is_configured_false_with_only_a_public_key() -> None:
    assert webpush.is_configured() is False


@override_settings(
    VAPID_PUBLIC_KEY=PUBLIC_KEY,
    VAPID_PRIVATE_KEY=PRIVATE_KEY,
    VAPID_SUBJECT="mailto:admin@example.org",
)
def test_is_configured_true_with_a_full_keypair() -> None:
    assert webpush.is_configured() is True


@override_settings(VAPID_SUBJECT="admin@example.org")
def test_subject_is_normalised_to_a_mailto_url() -> None:
    # Push services reject a bare address, and the rejection is a 403 at send time.
    assert webpush.get_subject() == "mailto:admin@example.org"


@override_settings(VAPID_SUBJECT="", DEFAULT_FROM_EMAIL="noreply@example.org")
def test_subject_falls_back_to_the_default_from_email() -> None:
    assert webpush.get_subject() == "mailto:noreply@example.org"


@override_settings(VAPID_SUBJECT="https://example.org/contact")
def test_subject_keeps_an_https_url_as_is() -> None:
    assert webpush.get_subject() == "https://example.org/contact"


@override_settings(
    VAPID_PUBLIC_KEY=PUBLIC_KEY,
    VAPID_PRIVATE_KEY=PRIVATE_KEY,
    VAPID_SUBJECT="mailto:admin@example.org",
)
@pytest.mark.django_db
def test_channel_needs_both_keys_and_a_subscribed_device() -> None:
    user = UserFactory()

    # Configured on the backend, but this user has no device yet.
    assert is_backend_configured(ProviderType.WEBPUSH) is True
    assert is_channel_available(ProviderType.WEBPUSH, user) is False

    PushSubscription.objects.create(
        user=user,
        endpoint="https://push.example.com/v1/abc",
        p256dh="key",
        auth="secret",
    )

    assert is_channel_available(ProviderType.WEBPUSH, user) is True


@override_settings(VAPID_PUBLIC_KEY="", VAPID_PRIVATE_KEY="", VAPID_SUBJECT="")
@pytest.mark.django_db
def test_channel_unavailable_without_keys_even_with_a_device() -> None:
    user = UserFactory()
    PushSubscription.objects.create(
        user=user,
        endpoint="https://push.example.com/v1/abc",
        p256dh="key",
        auth="secret",
    )

    assert is_channel_available(ProviderType.WEBPUSH, user) is False
