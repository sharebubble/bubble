"""VAPID key handling and configuration for browser push notifications.

Web push (RFC 8030) needs two things the other notification channels do not: an
application-server keypair to identify this deployment to the push services
(VAPID, RFC 8292), and a per-device subscription rather than a single address per
user. This module owns the first half — keys, claims and "is push usable at all";
:mod:`bubble.notifications.providers.webpush_provider` does the sending.

Keys are exchanged as base64url without padding, which is what the Push API
expects on the browser side:

* private key — the raw 32-byte P-256 scalar (``py_vapid`` reads this directly)
* public key  — the 65-byte uncompressed EC point, passed to
  ``pushManager.subscribe({applicationServerKey})``
"""

from __future__ import annotations

import base64
import logging

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.conf import settings

logger = logging.getLogger(__name__)


def b64url_encode(raw: bytes) -> str:
    """Encode *raw* as unpadded base64url."""
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def generate_keys() -> tuple[str, str]:
    """Generate a fresh VAPID keypair as ``(private_key, public_key)``.

    Both are unpadded base64url strings, ready to be dropped into
    VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY.
    """
    private_key = ec.generate_private_key(ec.SECP256R1())
    private_raw = private_key.private_numbers().private_value.to_bytes(32, "big")
    public_raw = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    return b64url_encode(private_raw), b64url_encode(public_raw)


def get_public_key() -> str:
    """The application server public key browsers subscribe with (or "")."""
    return (getattr(settings, "VAPID_PUBLIC_KEY", "") or "").strip()


def get_private_key() -> str:
    """The signing key for outgoing pushes (or "")."""
    return (getattr(settings, "VAPID_PRIVATE_KEY", "") or "").strip()


def get_subject() -> str:
    """Contact URL for the VAPID ``sub`` claim, or "" when unusable.

    RFC 8292 allows only a ``mailto:`` URI or an ``https:`` URL here, and push
    services enforce it. A bare address (the common case, e.g. from
    DEFAULT_FROM_EMAIL) is normalised to ``mailto:``.

    Anything else — an ``http:`` URL being the likely mistake — is rejected rather
    than passed through. Returning "" keeps :func:`is_configured` false, so push
    stays visibly off and the operator gets this warning, instead of every send
    failing later with an opaque 403 from the push service.
    """
    subject = (getattr(settings, "VAPID_SUBJECT", "") or "").strip()
    if not subject:
        subject = (getattr(settings, "DEFAULT_FROM_EMAIL", "") or "").strip()
    if not subject:
        return ""

    if subject.startswith(("mailto:", "https://")):
        return subject
    if "://" in subject:
        logger.warning(
            "VAPID_SUBJECT %r is not a mailto: or https: URL, so web push is "
            "disabled. RFC 8292 allows only those two schemes.",
            subject,
        )
        return ""
    return f"mailto:{subject}"


def is_configured() -> bool:
    """True when this deployment can send push notifications at all."""
    return bool(get_public_key() and get_private_key() and get_subject())
