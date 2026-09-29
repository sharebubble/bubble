"""Diagnostics for social logins that fail because the OAuth state is missing.

allauth stashes the OAuth ``state`` in the Django session when a login starts
and pops it again on the provider callback. When it is not there the login
fails with the opaque ``error=unknown``. The session cookie arriving is not
enough to rule out the session as the culprit, so this module records what the
browser looked like at the start of a login and lets the callback compare:

- A signed *start marker* cookie, set on the response that sends the browser
  to the provider. It carries a hash of the session key the state was stored
  in, the state id and a timestamp. Missing on the callback: the browser did
  not keep or send cookies from that response. Present with a different
  session hash: the callback runs in another session than the one holding the
  state (a shadowing cookie, or the session was rotated underneath it).
- A short-lived cache entry for every state that completed a login. A failing
  callback whose state is in there is a replay of a callback that already
  succeeded, i.e. the browser requested the callback URL twice.

Session keys are credentials, so only truncated hashes of them are reported.
"""

from __future__ import annotations

import hashlib
import time
import typing

from django.conf import settings
from django.core import signing
from django.core.cache import cache

if typing.TYPE_CHECKING:
    from django.http import HttpRequest, HttpResponse

STATES_SESSION_KEY = "socialaccount_states"
MARKER_SALT = "bubble.sso-start"
MARKER_MAX_AGE = 15 * 60
CONSUMED_STATE_TTL = 15 * 60
PROVIDER_REDIRECT_SUFFIX = "/auth/provider/redirect"


def marker_cookie_name() -> str:
    # `__Host-` needs the Secure flag, which local http development lacks.
    return "__Host-bubble-sso" if settings.SESSION_COOKIE_SECURE else "bubble-sso"


def hash_key(value: str | None) -> str | None:
    if not value:
        return None
    return hashlib.sha256(value.encode()).hexdigest()[:12]


def _consumed_cache_key(state_id: str) -> str:
    return f"socialaccount:consumed-state:{hash_key(state_id)}"


def _newest_state_id(request: HttpRequest) -> str | None:
    states = request.session.get(STATES_SESSION_KEY) or {}
    newest = None
    for state_id, (_state, ts) in states.items():
        if newest is None or ts > newest[1]:
            newest = (state_id, ts)
    return newest[0] if newest else None


def set_start_marker(request: HttpRequest, response: HttpResponse) -> None:
    """Remember which session and state a login started with.

    Must run after the session has been saved, so a session created by this
    very request already has its final key.
    """
    session = getattr(request, "session", None)
    if session is None or not session.session_key:
        return
    state_id = _newest_state_id(request)
    if not state_id:
        return
    value = ".".join(
        [hash_key(session.session_key) or "", state_id, str(int(time.time()))]
    )
    response.set_signed_cookie(
        marker_cookie_name(),
        value,
        salt=MARKER_SALT,
        max_age=MARKER_MAX_AGE,
        secure=settings.SESSION_COOKIE_SECURE,
        httponly=True,
        samesite="Lax",
        path="/",
    )


def read_start_marker(request: HttpRequest) -> dict[str, typing.Any] | None:
    try:
        value = request.get_signed_cookie(
            marker_cookie_name(), salt=MARKER_SALT, max_age=MARKER_MAX_AGE
        )
    except KeyError:
        return None
    except signing.BadSignature:
        return {"valid": False}
    session_hash, _, rest = value.partition(".")
    state_id, _, ts = rest.rpartition(".")
    return {
        "valid": True,
        "session_hash": session_hash,
        "state_id": state_id,
        "age_s": int(time.time()) - int(ts) if ts.isdigit() else None,
    }


def mark_state_consumed(request: HttpRequest) -> None:
    """Record that the callback's state completed a login."""
    state_id = request.GET.get("state")
    if state_id:
        cache.set(_consumed_cache_key(state_id), time.time(), CONSUMED_STATE_TTL)


def session_cookie_count(request: HttpRequest) -> int:
    """How many cookies named like the session cookie the browser sent.

    More than one means another cookie (e.g. set for a parent domain) shadows
    ours, and Django only ever sees one of them.
    """
    prefix = f"{settings.SESSION_COOKIE_NAME}="
    raw = request.META.get("HTTP_COOKIE", "")
    return sum(1 for part in raw.split(";") if part.strip().startswith(prefix))


def callback_diagnostics(request: HttpRequest) -> dict[str, typing.Any]:
    """Compare the failing callback against how the login started."""
    cookie_key = request.COOKIES.get(settings.SESSION_COOKIE_NAME)
    cookie_hash = hash_key(cookie_key)
    state_id = request.GET.get("state")

    marker = read_start_marker(request)
    if marker and marker.get("valid"):
        start = {
            "start_marker": "present",
            "start_marker_age_s": marker["age_s"],
            "start_session_matches": marker["session_hash"] == cookie_hash,
            "start_state_matches": bool(state_id) and marker["state_id"] == state_id,
        }
    else:
        start = {
            "start_marker": "invalid" if marker else "missing",
            "start_marker_age_s": None,
            "start_session_matches": None,
            "start_state_matches": None,
        }

    consumed_at = cache.get(_consumed_cache_key(state_id)) if state_id else None
    session_store = request.session.__class__()
    states = request.session.get(STATES_SESSION_KEY) or {}

    return {
        **start,
        "state_already_consumed": consumed_at is not None,
        "state_consumed_s_ago": (
            round(time.time() - consumed_at, 1) if consumed_at else None
        ),
        "session_cookie_count": session_cookie_count(request),
        "session_key_hash": cookie_hash,
        "session_row_exists": (
            session_store.exists(cookie_key) if cookie_key else None
        ),
        "session_other_states": len(states),
        "session_user_authenticated": request.user.is_authenticated
        if hasattr(request, "user")
        else None,
    }
