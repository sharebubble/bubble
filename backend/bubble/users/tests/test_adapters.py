from unittest.mock import MagicMock, patch

import pytest
import requests as requests_lib
from django.core.files.base import ContentFile

from bubble.users.adapters import SocialAccountAdapter
from bubble.users.models import Profile
from bubble.users.tests.factories import UserFactory

PHONE_MAX_LENGTH = Profile._meta.get_field("phone").max_length  # noqa: SLF001


def _make_mock_response(
    content: bytes = b"fake-image-bytes", content_type: str = "image/png"
):
    mock_resp = MagicMock()
    mock_resp.content = content
    mock_resp.headers = {"Content-Type": content_type}
    mock_resp.raise_for_status.return_value = None
    return mock_resp


@pytest.mark.django_db
def test_sync_profile_sets_phone_from_phone_number_claim() -> None:
    user = UserFactory()
    assert user.profile.phone == ""

    SocialAccountAdapter.sync_profile_from_oidc(user, {"phone_number": "+15551234567"})

    user.profile.refresh_from_db()
    assert user.profile.phone == "+15551234567"


@pytest.mark.django_db
def test_sync_profile_accepts_phone_claim_alias() -> None:
    user = UserFactory()

    SocialAccountAdapter.sync_profile_from_oidc(user, {"phone": "+436601234567"})

    user.profile.refresh_from_db()
    assert user.profile.phone == "+436601234567"


@pytest.mark.django_db
def test_sync_profile_does_not_overwrite_existing_phone() -> None:
    user = UserFactory()
    user.profile.phone = "+10000000000"
    user.profile.save()

    SocialAccountAdapter.sync_profile_from_oidc(user, {"phone_number": "+15551234567"})

    user.profile.refresh_from_db()
    assert user.profile.phone == "+10000000000"


@pytest.mark.django_db
def test_sync_profile_truncates_to_field_length() -> None:
    user = UserFactory()
    long_phone = "+" + "9" * 40

    SocialAccountAdapter.sync_profile_from_oidc(user, {"phone_number": long_phone})

    user.profile.refresh_from_db()
    assert len(user.profile.phone) == PHONE_MAX_LENGTH


@pytest.mark.django_db
def test_sync_profile_noop_without_phone_claim() -> None:
    user = UserFactory()

    SocialAccountAdapter.sync_profile_from_oidc(user, {"email": "x@example.com"})

    user.profile.refresh_from_db()
    assert user.profile.phone == ""


@pytest.mark.django_db
@patch("bubble.users.adapters.requests.get")
def test_sync_profile_sets_avatar_from_picture_claim(mock_get) -> None:
    user = UserFactory()
    assert not user.profile.profile_image
    mock_get.return_value = _make_mock_response()

    SocialAccountAdapter.sync_profile_from_oidc(
        user, {"picture": "https://idp.example.com/avatar.png"}
    )

    user.profile.refresh_from_db()
    assert user.profile.profile_image
    assert user.profile.profile_image.name.endswith(".png")
    mock_get.assert_called_once_with("https://idp.example.com/avatar.png", timeout=10)


@pytest.mark.django_db
@patch("bubble.users.adapters.requests.get")
def test_sync_profile_does_not_overwrite_existing_avatar(mock_get) -> None:
    user = UserFactory()
    user.profile.profile_image.save("existing.png", ContentFile(b"existing"), save=True)

    SocialAccountAdapter.sync_profile_from_oidc(
        user, {"picture": "https://idp.example.com/avatar.png"}
    )

    mock_get.assert_not_called()


@pytest.mark.django_db
@patch("bubble.users.adapters.requests.get")
def test_sync_profile_avatar_fetch_failure_is_swallowed(mock_get) -> None:
    user = UserFactory()
    mock_get.side_effect = requests_lib.ConnectionError("boom")

    SocialAccountAdapter.sync_profile_from_oidc(
        user, {"picture": "https://idp.example.com/avatar.png"}
    )

    user.profile.refresh_from_db()
    assert not user.profile.profile_image


@pytest.mark.django_db
def test_sync_profile_noop_without_picture_claim() -> None:
    user = UserFactory()

    SocialAccountAdapter.sync_profile_from_oidc(user, {"email": "x@example.com"})

    user.profile.refresh_from_db()
    assert not user.profile.profile_image
