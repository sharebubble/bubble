import time

import pytest
from django.conf import settings as django_settings
from django.contrib.sessions.backends.db import SessionStore
from django.core.cache import cache
from django.http import HttpResponse, HttpResponseRedirect

from bubble.core.middleware import SocialLoginStartMarkerMiddleware
from bubble.users import sso_diagnostics

REDIRECT_PATH = "/api/_allauth/browser/v1/auth/provider/redirect"
CALLBACK_PATH = "/accounts/oidc/authentik/login/callback/"


@pytest.fixture(autouse=True)
def _local_cache(settings):
    # The test settings inherit a Redis cache that silently ignores errors.
    settings.CACHES = {
        "default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}
    }
    cache.clear()


def _session_with_state(state_id: str = "st1") -> SessionStore:
    session = SessionStore()
    session[sso_diagnostics.STATES_SESSION_KEY] = {
        "old": [{"process": "login"}, time.time() - 60],
        state_id: [{"process": "login"}, time.time()],
    }
    session.save()
    return session


def _start_login(rf, session: SessionStore) -> HttpResponse:
    request = rf.post(REDIRECT_PATH)
    request.session = session
    middleware = SocialLoginStartMarkerMiddleware(
        lambda _: HttpResponseRedirect("https://auth.example.org/authorize")
    )
    return middleware(request)


def _callback(rf, *, state="st1", session_key=None, marker=None, extra_cookie=""):
    cookies = []
    if session_key:
        cookies.append(f"{django_settings.SESSION_COOKIE_NAME}={session_key}")
    if marker:
        cookies.append(f"{sso_diagnostics.marker_cookie_name()}={marker}")
    header = "; ".join(cookies) + extra_cookie
    request = rf.get(f"{CALLBACK_PATH}?code=c&state={state}", HTTP_COOKIE=header)
    request.session = SessionStore(session_key)
    return request


@pytest.mark.django_db
def test_marker_matches_session_and_state_of_the_login_start(rf) -> None:
    session = _session_with_state()
    response = _start_login(rf, session)

    marker = response.cookies[sso_diagnostics.marker_cookie_name()].value
    request = _callback(rf, session_key=session.session_key, marker=marker)
    result = sso_diagnostics.callback_diagnostics(request)

    assert result["start_marker"] == "present"
    assert result["start_session_matches"] is True
    assert result["start_state_matches"] is True
    assert result["session_row_exists"] is True
    assert result["session_cookie_count"] == 1
    assert result["state_already_consumed"] is False


@pytest.mark.django_db
def test_marker_detects_callback_in_another_session(rf) -> None:
    response = _start_login(rf, _session_with_state())
    marker = response.cookies[sso_diagnostics.marker_cookie_name()].value

    other = SessionStore()
    other.save()
    result = sso_diagnostics.callback_diagnostics(
        _callback(rf, session_key=other.session_key, marker=marker)
    )

    assert result["start_session_matches"] is False


@pytest.mark.django_db
def test_missing_and_tampered_marker(rf) -> None:
    assert sso_diagnostics.callback_diagnostics(_callback(rf))["start_marker"] == (
        "missing"
    )
    tampered = sso_diagnostics.callback_diagnostics(_callback(rf, marker="x.y.1:bad"))
    assert tampered["start_marker"] == "invalid"


@pytest.mark.django_db
def test_no_marker_for_failed_login_start(rf) -> None:
    request = rf.post(REDIRECT_PATH)
    request.session = _session_with_state()
    response = SocialLoginStartMarkerMiddleware(
        lambda _: HttpResponseRedirect("/?error=unknown&error_process=login")
    )(request)

    assert sso_diagnostics.marker_cookie_name() not in response.cookies


@pytest.mark.django_db
def test_replayed_callback_is_recognised(rf) -> None:
    first = rf.get(f"{CALLBACK_PATH}?code=c&state=st1")
    sso_diagnostics.mark_state_consumed(first)

    result = sso_diagnostics.callback_diagnostics(_callback(rf))

    assert result["state_already_consumed"] is True
    assert result["state_consumed_s_ago"] >= 0


@pytest.mark.django_db
def test_counts_shadowing_session_cookies(rf) -> None:
    request = _callback(
        rf,
        session_key="abc",
        extra_cookie=f"; {django_settings.SESSION_COOKIE_NAME}=def",
    )
    result = sso_diagnostics.callback_diagnostics(request)

    assert result["session_cookie_count"] == 2  # noqa: PLR2004
    assert result["session_row_exists"] is False
    # Only hashes of session keys leave the server.
    assert "abc" not in str(result)
