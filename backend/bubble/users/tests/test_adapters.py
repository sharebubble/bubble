import json
from unittest.mock import MagicMock, patch

import pytest
import requests as requests_lib
from allauth.socialaccount.providers.base import AuthError
from django.conf import settings
from django.contrib.sessions.backends.db import SessionStore
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


def _callback_request(rf, query: str = "", *, secure: bool = False, cookie=True):

    request = rf.get(
        f"/accounts/oidc/authentik/login/callback/{query}",
        secure=secure,
    )
    request.session = SessionStore()
    if cookie:
        request.COOKIES[settings.SESSION_COOKIE_NAME] = "abc"
    return request


def _captured_context(capture_message, set_context):
    capture_message.assert_called_once()
    (name, context), _ = set_context.call_args
    assert name == "social_auth"
    return context


@pytest.mark.django_db
def test_authentication_error_reports_missing_state(rf) -> None:
    request = _callback_request(rf, "?code=c&state=s1", cookie=False)
    provider = MagicMock(id="openid_connect")
    provider.name = "Treibhaus Login"

    with (
        patch("bubble.users.adapters.sentry_sdk.capture_message") as capture,
        patch("sentry_sdk.Scope.set_context") as set_context,
    ):
        SocialAccountAdapter().on_authentication_error(
            request,
            provider,
            error=AuthError.UNKNOWN,
            extra_context={"state_id": "s1", "callback_view": object()},
        )

    context = _captured_context(capture, set_context)
    assert context["state_found"] is False
    assert context["state_id_present"] is True
    assert context["has_session_cookie"] is False
    assert context["is_secure"] is False
    assert context["provider_error"] is None
    assert request._social_auth_error_reported is True  # noqa: SLF001
    # Must be serializable, unlike allauth's raw extra_context.
    json.dumps(context)


@pytest.mark.django_db
def test_authentication_error_reports_provider_error(rf) -> None:
    request = _callback_request(
        rf,
        "?error=invalid_scope&error_description=nope&state=s1",
        secure=True,
    )
    provider = MagicMock(id="openid_connect")
    provider.name = "Treibhaus Login"

    with (
        patch("bubble.users.adapters.sentry_sdk.capture_message") as capture,
        patch("sentry_sdk.Scope.set_context") as set_context,
    ):
        SocialAccountAdapter().on_authentication_error(
            request,
            provider,
            error=AuthError.UNKNOWN,
            extra_context={"state": {"process": "login"}, "callback_view": object()},
        )

    context = _captured_context(capture, set_context)
    assert context["state_found"] is True
    assert context["state_process"] == "login"
    assert context["provider_error"] == "invalid_scope"
    assert context["provider_error_description"] == "nope"
    assert context["has_code"] is False
    assert context["is_secure"] is True
