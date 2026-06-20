"""Mapping between notification providers, their Apprise URL configuration and
the per-user field that identifies the recipient on each channel.

A channel is *available* to a user when both:

* the backend has an Apprise URL template configured (Constance), and
* the user has filled in the field that channel needs to address them
  (RocketChat → username, Signal → phone number, Email → email address).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from constance import config

from bubble.notifications.models import NotificationPreference

if TYPE_CHECKING:
    from bubble.users.models import User

ProviderType = NotificationPreference.ProviderType

# Constance key holding the Apprise URL template for each provider.
PROVIDER_CONFIG_KEYS: dict[str, str] = {
    ProviderType.ROCKETCHAT: "APPRISE_ROCKETCHAT_URL",
    ProviderType.SIGNAL: "APPRISE_SIGNAL_URL",
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
    """Return the per-user recipient address for *provider_type* (or "")."""
    if provider_type == ProviderType.ROCKETCHAT:
        return (user.username or "").strip()
    if provider_type == ProviderType.SIGNAL:
        profile = getattr(user, "profile", None)
        return (getattr(profile, "phone", "") or "").strip()
    if provider_type == ProviderType.EMAIL:
        return (user.email or "").strip()
    return ""


def is_backend_configured(provider_type: str) -> bool:
    """True when an Apprise URL template is configured for *provider_type*."""
    return bool(get_url_template(provider_type))


def is_channel_available(provider_type: str, user: User) -> bool:
    """True when the channel is configured *and* the user can be addressed."""
    return is_backend_configured(provider_type) and bool(
        resolve_target(provider_type, user)
    )


def build_apprise_url(template: str, target: str) -> str:
    """Substitute the recipient *target* into an Apprise URL *template*.

    When the template contains ``{target}`` it is replaced in place; otherwise
    the target is appended as a path segment so simple base URLs keep working.
    """
    if TARGET_PLACEHOLDER in template:
        return template.replace(TARGET_PLACEHOLDER, target)
    return f"{template.rstrip('/')}/{target}"
