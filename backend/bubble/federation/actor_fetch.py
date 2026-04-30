"""Remote actor fetching and caching.

Fetches and caches ActivityPub actor documents from remote instances.
Uses the instance actor key to sign outbound fetch requests when needed.
"""

from __future__ import annotations

import logging
from urllib.parse import urlparse

import httpx

from bubble.federation.models import AllowlistState, RemoteActor, RemoteInstance

logger = logging.getLogger(__name__)

_FETCH_TIMEOUT = 10
_AP_HEADERS = {
    "Accept": "application/activity+json, application/ld+json",
}


def fetch_remote_actor(actor_uri: str, *, force_refresh: bool = False):
    """Return a cached or freshly fetched ``RemoteActor`` for *actor_uri*.

    Creates or updates the ``RemoteActor`` and its parent ``RemoteInstance``
    records as a side effect.

    Raises ``httpx.HTTPError`` or ``ValueError`` on fetch failure.
    """
    # Check cache first (skip if force_refresh)
    if not force_refresh:
        try:
            return RemoteActor.objects.select_related("instance").get(
                ap_id=actor_uri, deleted=False
            )
        except RemoteActor.DoesNotExist:
            pass

    domain = urlparse(actor_uri).netloc
    if not domain:
        msg = f"Cannot derive domain from actor URI: {actor_uri}"
        raise ValueError(msg)

    # Fetch the actor document
    response = httpx.get(
        actor_uri,
        headers=_AP_HEADERS,
        timeout=_FETCH_TIMEOUT,
        follow_redirects=True,
    )
    response.raise_for_status()
    doc = response.json()

    # Upsert instance record
    instance, _ = RemoteInstance.objects.get_or_create(
        domain=domain,
        defaults={"allowlist_state": AllowlistState.PENDING},
    )

    # Extract public key
    public_key_data = doc.get("publicKey", {})
    public_key_pem = public_key_data.get("publicKeyPem", "")
    if not public_key_pem:
        msg = f"Actor {actor_uri} has no publicKeyPem"
        raise ValueError(msg)

    endpoints = doc.get("endpoints", {})
    shared_inbox = endpoints.get("sharedInbox", "")

    actor, _ = RemoteActor.objects.update_or_create(
        ap_id=actor_uri,
        defaults={
            "instance": instance,
            "actor_type": doc.get("type", "Person"),
            "preferred_username": doc.get("preferredUsername", ""),
            "name": doc.get("name", ""),
            "summary": doc.get("summary", ""),
            "inbox_url": doc.get("inbox", ""),
            "shared_inbox_url": shared_inbox,
            "outbox_url": doc.get("outbox", ""),
            "public_key_pem": public_key_pem,
            "icon_url": _extract_icon_url(doc),
            "url": doc.get("url", actor_uri),
            "deleted": False,
        },
    )

    # Update shared inbox on instance if known
    if shared_inbox and not instance.inbox_url:
        instance.inbox_url = shared_inbox
        instance.save(update_fields=["inbox_url"])

    return actor


def _extract_icon_url(doc: dict) -> str:
    icon = doc.get("icon")
    if not icon:
        return ""
    if isinstance(icon, str):
        return icon
    if isinstance(icon, dict):
        return icon.get("url", "")
    if isinstance(icon, list) and icon:
        first = icon[0]
        return first.get("url", "") if isinstance(first, dict) else str(first)
    return ""
