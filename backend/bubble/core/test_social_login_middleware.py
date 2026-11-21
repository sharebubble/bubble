from unittest.mock import MagicMock, patch

from django.contrib.auth.models import AnonymousUser
from django.contrib.sessions.backends.db import SessionStore
from django.http import HttpResponseRedirect

from bubble.core.middleware import SocialLoginErrorLoggingMiddleware

ERROR_REDIRECT = "https://share.example.org/?error=unknown&error_process=login"


def _request(rf):
    request = rf.get("/accounts/oidc/authentik/login/callback/")
    request.session = SessionStore()
    request.user = AnonymousUser()
    return request


def test_reports_error_redirect(rf) -> None:
    request = _request(rf)
    middleware = SocialLoginErrorLoggingMiddleware(
        lambda _: HttpResponseRedirect(ERROR_REDIRECT)
    )

    with patch("bubble.core.middleware.sentry_sdk.capture_message") as capture:
        middleware(request)

    capture.assert_called_once()


def test_skips_error_redirect_already_reported_by_adapter(rf) -> None:
    request = _request(rf)

    def view(req):
        req._social_auth_error_reported = True  # noqa: SLF001
        return HttpResponseRedirect(ERROR_REDIRECT)

    with patch("bubble.core.middleware.sentry_sdk.capture_message") as capture:
        response = SocialLoginErrorLoggingMiddleware(view)(request)

    capture.assert_not_called()
    assert response["Location"] == ERROR_REDIRECT


def test_ignores_non_error_redirect(rf) -> None:
    middleware = SocialLoginErrorLoggingMiddleware(
        lambda _: HttpResponseRedirect("https://share.example.org/")
    )
    with patch("bubble.core.middleware.sentry_sdk.capture_message") as capture:
        middleware(MagicMock())
    capture.assert_not_called()
