import pytest
from constance.test import override_config

from bubble.notifications.channels import (
    build_apprise_url,
    is_channel_available,
    resolve_target,
)
from bubble.notifications.models import NotificationPreference
from bubble.users.tests.factories import UserFactory

ProviderType = NotificationPreference.ProviderType


def test_build_apprise_url_substitutes_placeholder() -> None:
    template = "signal://api.example.com/+15550000/{target}"
    # The target is URL-encoded, so the leading "+" becomes "%2B".
    assert (
        build_apprise_url(template, "+15551234")
        == "signal://api.example.com/+15550000/%2B15551234"
    )


def test_build_apprise_url_appends_when_no_placeholder() -> None:
    # "@" is encoded to "%40" so it cannot corrupt the URL.
    assert build_apprise_url("mailtos://host/", "a@b.com") == "mailtos://host/a%40b.com"


@pytest.mark.django_db
def test_resolve_target_per_provider() -> None:
    user = UserFactory(username="alice", email="alice@example.com")
    user.profile.phone = "+15551234"
    user.profile.save()

    assert resolve_target(ProviderType.ROCKETCHAT, user) == "alice"
    assert resolve_target(ProviderType.SIGNAL, user) == "+15551234"
    assert resolve_target(ProviderType.EMAIL, user) == "alice@example.com"


@pytest.mark.django_db
@override_config(
    APPRISE_SIGNAL_URL="signal://api/+1555/{target}",
    APPRISE_ROCKETCHAT_URL="",
)
def test_is_channel_available_requires_backend_and_target() -> None:
    user = UserFactory(username="alice")
    # Signal backend configured but the user has no phone yet.
    assert is_channel_available(ProviderType.SIGNAL, user) is False

    user.profile.phone = "+15551234"
    user.profile.save()
    assert is_channel_available(ProviderType.SIGNAL, user) is True

    # RocketChat has a target (username) but no backend URL configured.
    assert is_channel_available(ProviderType.ROCKETCHAT, user) is False
