"""Mapping between notification providers, their Apprise URL configuration and
the per-user field that identifies the recipient on each channel.

A channel is *available* to a user when both:

* the backend has an Apprise URL template configured (Constance), and
* the user has filled in the field that channel needs to address them
  (RocketChat → username, Signal → phone number, Email → email address).
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import quote

from constance import config
from django.conf import settings

from bubble.notifications import webpush
from bubble.notifications.models import NotificationPreference

if TYPE_CHECKING:
    from bubble.users.models import User

ProviderType = NotificationPreference.ProviderType

# Constance key holding the Apprise URL template for each provider.
PROVIDER_CONFIG_KEYS: dict[str, str] = {
    ProviderType.ROCKETCHAT: "APPRISE_ROCKETCHAT_URL",
    ProviderType.SIGNAL: "APPRISE_SIGNAL_URL",
    ProviderType.MATRIX: "APPRISE_MATRIX_URL",
    ProviderType.EMAIL: "APPRISE_MAILTOS_URL",
}

# Placeholder substituted with the recipient's address inside the URL template.
TARGET_PLACEHOLDER = "{target}"


def get_url_template(provider_type: str) -> str:
    """Return the configured Apprise URL template for *provider_type* (or "")."""
    key = PROVIDER_CONFIG_KEYS.get(provider_type)
    if not key:
        return ""
    return (getattr(config, key, "") or "").strip()


def resolve_target(provider_type: str, user: User) -> str:
    """Return the per-user recipient address for *provider_type* (or "").

    Browser push has no such address — it is delivered to whichever devices have
    subscribed — so it always resolves to the empty string. Use
    :func:`is_channel_available` to decide whether a user can be pushed to.
    """
    if provider_type == ProviderType.ROCKETCHAT:
        username = (user.username or "").strip()
        # Apprise only recognizes a RocketChat target as a user to DM (rather
        # than dropping it, or misreading it as a room ID) when it is
        # "@"-prefixed — see NotifyRocketChat's IS_USER pattern.
        return f"@{username}" if username else ""
    if provider_type == ProviderType.SIGNAL:
        profile = getattr(user, "profile", None)
        return (getattr(profile, "phone", "") or "").strip()
    if provider_type == ProviderType.MATRIX:
        profile = getattr(user, "profile", None)
        return (getattr(profile, "matrix_id", "") or "").strip()
    if provider_type == ProviderType.EMAIL:
        return (user.email or "").strip()
    return ""


def default_matrix_id(user: User) -> str:
    """Return the Matrix ID a user would have on this deployment's homeserver
    (e.g. "@alice:example.com"), or "" when either half is unavailable.

    Used to prefill the Matrix ID field with a sensible guess — the user's
    bubble username on this site's own homeserver — see APPRISE_MATRIX_HOSTNAME.
    """
    username = (user.username or "").strip().lstrip("@")
    hostname = (settings.APPRISE_MATRIX_HOSTNAME or "").strip()
    if not username or not hostname:
        return ""
    return f"@{username}:{hostname}"


def is_backend_configured(provider_type: str) -> bool:
    """True when *provider_type* is usable by this deployment.

    For the Apprise channels that means a URL template is configured; browser
    push instead needs a VAPID keypair (it addresses devices, not accounts, so it
    has no Apprise URL — see :mod:`bubble.notifications.webpush`).
    """
    if provider_type == ProviderType.WEBPUSH:
        return webpush.is_configured()
    return bool(get_url_template(provider_type))


def is_channel_available(provider_type: str, user: User) -> bool:
    """True when the channel is configured *and* the user can be reached on it.

    Browser push is per device rather than per account: instead of an address on
    the user's profile, it needs at least one browser that has subscribed, which
    only happens after that browser granted notification permission.
    """
    if not is_backend_configured(provider_type):
        return False
    if provider_type == ProviderType.WEBPUSH:
        return user.push_subscriptions.exists()
    return bool(resolve_target(provider_type, user))


def build_apprise_url(template: str, target: str) -> str:
    """Substitute the recipient *target* into an Apprise URL *template*.

    When the template contains ``{target}`` it is replaced in place; otherwise
    the target is appended as a path segment so simple base URLs keep working.

    The target is URL-encoded so reserved characters (e.g. ``@`` or ``+`` in
    ``alice+foo@example.com``) cannot corrupt the resulting Apprise URL.
    """
    encoded = quote(target, safe="")
    if TARGET_PLACEHOLDER in template:
        return template.replace(TARGET_PLACEHOLDER, encoded)
    return f"{template.rstrip('/')}/{encoded}"
