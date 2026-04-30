"""Cryptographic helpers for ActivityPub HTTP Signatures.

Key management:
  - RSA-2048 keypairs per local user (``LocalActorKey``)
  - RSA-2048 keypair for the instance actor (``InstanceActorKey``)
  - Private keys stored AES-GCM-encrypted using ``FEDERATION_KEY_ENCRYPTION_KEY``

HTTP Signatures (draft-cavage-http-signatures-12):
  - Sign outbound requests with ``sign_request``
  - Verify inbound requests with ``verify_signature``
"""

from __future__ import annotations

import base64
import datetime
import hashlib
import logging
import os
from typing import TYPE_CHECKING
from urllib.parse import urlparse

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from django.conf import settings

if TYPE_CHECKING:
    from cryptography.hazmat.primitives.asymmetric.rsa import (
        RSAPrivateKey,
        RSAPublicKey,
    )

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_RSA_KEY_SIZE = 2048

# ---------------------------------------------------------------------------
# Encryption helpers
# ---------------------------------------------------------------------------


def _get_aes_key() -> bytes:
    """Return the raw 32-byte key for AES-GCM encryption.

    The setting ``FEDERATION_KEY_ENCRYPTION_KEY`` must be a URL-safe
    base64-encoded 32-byte value, e.g. generated with::

        python -c "import secrets, base64; \\
            print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
    """
    raw = getattr(settings, "FEDERATION_KEY_ENCRYPTION_KEY", "")
    if not raw:
        msg = (
            "FEDERATION_KEY_ENCRYPTION_KEY is not set. "
            "Cannot encrypt/decrypt actor keys."
        )
        raise RuntimeError(msg)
    return base64.urlsafe_b64decode(raw + "==")  # pad to avoid length errors


def encrypt_private_key(private_key: RSAPrivateKey) -> str:
    """Serialize and AES-GCM-encrypt an RSA private key.

    Returns a base64-encoded string: ``nonce(12 bytes) || ciphertext``.
    """
    pem_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    key = _get_aes_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, pem_bytes, None)
    blob = nonce + ciphertext
    return base64.urlsafe_b64encode(blob).decode()


def decrypt_private_key(encrypted: str) -> RSAPrivateKey:
    """Decrypt and deserialize a private key stored by ``encrypt_private_key``."""
    blob = base64.urlsafe_b64decode(encrypted + "==")
    nonce = blob[:12]
    ciphertext = blob[12:]
    key = _get_aes_key()
    aesgcm = AESGCM(key)
    pem_bytes = aesgcm.decrypt(nonce, ciphertext, None)
    return serialization.load_pem_private_key(pem_bytes, password=None)


# ---------------------------------------------------------------------------
# Key generation
# ---------------------------------------------------------------------------


def generate_rsa_keypair() -> tuple[RSAPrivateKey, str, str]:
    """Generate an RSA-2048 keypair.

    Returns ``(private_key, public_key_pem, encrypted_private_key)``.
    """
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=_RSA_KEY_SIZE,
    )
    public_key_pem = (
        private_key.public_key()
        .public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode()
    )
    encrypted_private = encrypt_private_key(private_key)
    return private_key, public_key_pem, encrypted_private


def generate_and_store_keypair(model_class, **extra_fields):
    """Generate a keypair and save it to ``model_class``.

    Works for both ``LocalActorKey`` (pass ``user=user``) and
    ``InstanceActorKey`` (no extra fields).
    """
    _, public_key_pem, encrypted_private = generate_rsa_keypair()
    return model_class.objects.create(
        public_key_pem=public_key_pem,
        private_key_encrypted=encrypted_private,
        **extra_fields,
    )


def get_or_create_user_key(user):
    """Return the ``LocalActorKey`` for *user*, creating it lazily if needed."""
    from bubble.federation.models import LocalActorKey  # noqa: PLC0415

    try:
        return LocalActorKey.objects.get(user=user)
    except LocalActorKey.DoesNotExist:
        return generate_and_store_keypair(LocalActorKey, user=user)


# ---------------------------------------------------------------------------
# HTTP Signatures -- draft-cavage-http-signatures-12 (Mastodon-compatible)
#
# We implement this directly using ``cryptography`` rather than relying on the
# ``http_message_signatures`` library, which targets RFC 9421 and has a
# different API.
# ---------------------------------------------------------------------------


def _http_date() -> str:
    return datetime.datetime.now(datetime.UTC).strftime("%a, %d %b %Y %H:%M:%S GMT")


def sign_request(  # noqa: PLR0913
    *,
    method: str,
    url: str,
    headers: dict,
    body: bytes | None,
    private_key: RSAPrivateKey,
    key_id: str,
) -> dict:
    """Sign an HTTP request using draft-cavage HTTP Signatures.

    Adds ``Date``, ``Digest`` (when *body* is provided), and ``Signature``
    headers -- the set Mastodon validates.

    Returns a new dict with all original headers plus the signature headers.
    """
    out = dict(headers)
    parsed = urlparse(url)

    if "host" not in {k.lower() for k in out}:
        out["host"] = parsed.netloc
    if "date" not in {k.lower() for k in out}:
        out["date"] = _http_date()
    if body and "digest" not in {k.lower() for k in out}:
        digest = base64.b64encode(hashlib.sha256(body).digest()).decode()
        out["digest"] = f"SHA-256={digest}"

    # Build the signing string (lowercase header names)
    lc = {k.lower(): v for k, v in out.items()}
    request_target = f"{method.lower()} {parsed.path or '/'}"
    if parsed.query:
        request_target += f"?{parsed.query}"

    signed_headers = ["(request-target)", "host", "date"]
    if "digest" in lc:
        signed_headers.append("digest")

    signing_string_parts = [f"(request-target): {request_target}"]
    signing_string_parts.extend(f"{h}: {lc[h]}" for h in signed_headers[1:])
    signing_string = "\n".join(signing_string_parts)

    signature_bytes = private_key.sign(
        signing_string.encode(),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )
    signature_b64 = base64.b64encode(signature_bytes).decode()

    headers_param = " ".join(signed_headers)
    out["signature"] = (
        f'keyId="{key_id}",'
        f'algorithm="rsa-sha256",'
        f'headers="{headers_param}",'
        f'signature="{signature_b64}"'
    )
    return out


def verify_signature(  # noqa: PLR0913
    *,
    method: str,
    url: str,
    headers: dict,
    body: bytes | None,
    public_key_pem: str,
    key_id: str,
) -> bool:
    """Verify a draft-cavage HTTP Signature on an inbound request.

    Returns ``True`` if valid, ``False`` otherwise.
    Logs the reason for failure at DEBUG level.
    """
    try:
        public_key: RSAPublicKey = serialization.load_pem_public_key(
            public_key_pem.encode()
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("Failed to load public key for %s: %s", key_id, exc)
        return False

    lc = {k.lower(): v for k, v in headers.items()}
    signing_string = _build_verify_signing_string(method, url, lc)
    if signing_string is None:
        return False

    sig_header = lc.get("signature", "")
    signature_b64 = _extract_signature_value(sig_header)
    if not signature_b64:
        return False

    try:
        signature_bytes = base64.b64decode(signature_b64)
    except Exception as exc:  # noqa: BLE001
        logger.debug("Failed to decode signature: %s", exc)
        return False

    try:
        public_key.verify(
            signature_bytes,
            signing_string.encode(),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("HTTP Signature verification failed: %s", exc)
        return False
    else:
        return True


def _extract_signature_value(sig_header: str) -> str:
    """Extract the ``signature`` value from a cavage Signature header string."""
    if not sig_header:
        logger.debug("No Signature header present")
        return ""
    params: dict[str, str] = {}
    for raw_part in sig_header.split(","):
        part = raw_part.strip()
        if "=" not in part:
            continue
        k, _, v = part.partition("=")
        params[k.strip()] = v.strip().strip('"')
    value = params.get("signature", "")
    if not value:
        logger.debug("No signature value in Signature header")
    return value


def _build_verify_signing_string(method: str, url: str, lc_headers: dict) -> str | None:
    """Reconstruct the signing string from lowercase request headers.

    Returns ``None`` and logs at DEBUG if a required header is absent.
    """
    sig_header = lc_headers.get("signature", "")
    params: dict[str, str] = {}
    for raw_part in sig_header.split(","):
        part = raw_part.strip()
        if "=" not in part:
            continue
        k, _, v = part.partition("=")
        params[k.strip()] = v.strip().strip('"')

    signed_headers = params.get("headers", "date").split()
    parsed = urlparse(url)
    request_target = f"{method.lower()} {parsed.path or '/'}"
    if parsed.query:
        request_target += f"?{parsed.query}"

    parts: list[str] = []
    for h in signed_headers:
        if h == "(request-target)":
            parts.append(f"(request-target): {request_target}")
        elif h in lc_headers:
            parts.append(f"{h}: {lc_headers[h]}")
        else:
            logger.debug("Missing signed header %s in request", h)
            return None
    return "\n".join(parts)


def rsa_sign_bytes(data: bytes, private_key: RSAPrivateKey) -> bytes:
    """Low-level RSA-SHA256 sign *data* -- used for LD Signatures if needed."""
    return private_key.sign(data, padding.PKCS1v15(), hashes.SHA256())


def rsa_verify_bytes(data: bytes, signature: bytes, public_key_pem: str) -> bool:
    """Verify an RSA-SHA256 signature over *data*."""
    try:
        public_key: RSAPublicKey = serialization.load_pem_public_key(
            public_key_pem.encode()
        )
        public_key.verify(signature, data, padding.PKCS1v15(), hashes.SHA256())
    except Exception:  # noqa: BLE001
        return False
    else:
        return True
