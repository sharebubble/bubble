from __future__ import annotations

import logging
import urllib.parse

import sentry_sdk
from django.http import HttpResponseRedirect

from bubble.users import sso_diagnostics

logger = logging.getLogger(__name__)


class SocialLoginStartMarkerMiddleware:
    """Mark the browser when it leaves for a social login provider.

    Sits above ``SessionMiddleware`` so the session has been saved, and a new
    one has its final key, by the time the response passes through here. See
    ``bubble.users.sso_diagnostics`` for how the callback uses the marker.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if (
            request.method == "POST"
            and request.path.rstrip("/").endswith(
                sso_diagnostics.PROVIDER_REDIRECT_SUFFIX
            )
            and isinstance(response, HttpResponseRedirect)
            # A start that failed redirects back with ?error= and stashed no
            # state; marking it would point the callback at an older one.
            and "error"
            not in urllib.parse.parse_qs(
                urllib.parse.urlparse(response.get("Location", "")).query
            )
        ):
            sso_diagnostics.set_start_marker(request, response)
        return response


class SocialLoginErrorLoggingMiddleware:
    """Capture social login error redirects that would otherwise leave no trace.

    django-allauth reports many OIDC/OAuth2 failures by redirecting the browser
    back to the SPA with `?error=<code>&error_process=login`. Some of those
    errors (notably `error=unknown`) are produced deep in the completion flow
    where the adapter's ``on_authentication_error()`` hook is not called. This
    middleware inspects outgoing redirects and logs the ones that look like
    social login failures, together with request context that helps diagnose
    them.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        if not isinstance(response, HttpResponseRedirect):
            return response

        location = response.get("Location", "")
        parsed = urllib.parse.urlparse(location)
        query = urllib.parse.parse_qs(parsed.query)

        error_values = query.get("error")
        error_process_values = query.get("error_process")
        if not error_values or "login" not in error_process_values:
            return response

        error_code = error_values[0]
        # Strip the code/id_token from any provider callback URL that might
        # have been left in the query string before logging.
        safe_query = {
            k: v
            for k, v in query.items()
            if k not in {"code", "id_token", "access_token", "refresh_token"}
        }

        context = {
            "error_code": error_code,
            "error_process": error_process_values[0] if error_process_values else None,
            "redirect_location": urllib.parse.urlunparse(
                parsed._replace(query=urllib.parse.urlencode(safe_query, doseq=True))
            ),
            "request_path": request.path,
            "request_method": request.method,
            "user_agent": request.headers.get("user-agent"),
            "remote_addr": request.META.get("REMOTE_ADDR"),
            "referer": request.headers.get("referer"),
            "session_key_hash": sso_diagnostics.hash_key(request.session.session_key),
            "user_id": str(request.user.pk) if request.user.is_authenticated else None,
        }

        logger.warning(
            "Social login error redirect: error=%s path=%s location=%s",
            error_code,
            request.path,
            context["redirect_location"],
            extra={"social_auth_redirect_context": context},
        )

        # The adapter already captured this failure with the underlying cause;
        # a second event here would only split it into a duplicate issue.
        if getattr(request, "_social_auth_error_reported", False):
            return response

        with sentry_sdk.new_scope() as scope:
            scope.set_context("social_auth_redirect", context)
            scope.set_tag("auth_error_code", error_code)
            scope.set_tag("auth_error_process", error_process_values[0])
            sentry_sdk.capture_message(
                f"Social login error redirect: {error_code}",
                level="warning",
            )

        return response
