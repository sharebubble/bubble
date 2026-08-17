"""Thin wrapper around :mod:`pywebpush` for delivering browser push messages.

Mirrors :mod:`bubble.notifications.providers.apprise_provider`: it knows how to
put one message on the wire and nothing about preferences or event types.

The distinction that matters to callers is *why* a send failed. A push service
answering 404 or 410 is telling us the subscription is gone for good and the row
should be deleted; anything else (timeout, 5xx, 429) is transient and the
subscription must be kept.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from django.conf import settings
from pywebpush import WebPushException, webpush

from bubble.notifications.webpush import get_private_key, get_subject

logger = logging.getLogger(__name__)

# Status codes that mean "this subscription no longer exists".
GONE_STATUS_CODES = frozenset({404, 410})


@dataclass(frozen=True)
class PushResult:
    """Outcome of a single push attempt."""

    delivered: bool
    # True only when the push service said the subscription is permanently gone.
    expired: bool = False


def send_web_push(subscription_info: dict, payload: dict) -> PushResult:
    """Deliver *payload* (JSON-encoded) to one subscription.

    Never raises: the caller is a background task fanning out to many devices,
    and one dead browser must not stop the rest.
    """
    private_key = get_private_key()
    subject = get_subject()
    if not (private_key and subject):
        logger.debug("Web push is not configured — skipping send.")
        return PushResult(delivered=False)

    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps(payload),
            vapid_private_key=private_key,
            # aud is derived from the endpoint by pywebpush; exp is set per send.
            vapid_claims={"sub": subject},
            ttl=getattr(settings, "VAPID_TTL_SECONDS", 12 * 60 * 60),
        )
    except WebPushException as exc:
        status_code = getattr(exc.response, "status_code", None)
        if status_code in GONE_STATUS_CODES:
            logger.info(
                "Push subscription is gone (HTTP %s) — it will be removed.",
                status_code,
            )
            return PushResult(delivered=False, expired=True)
        logger.warning("Web push delivery failed (HTTP %s): %s", status_code, exc)
        return PushResult(delivered=False)
    except Exception:
        # Bad key material, DNS failure, malformed endpoint …
        logger.exception("Unexpected error delivering web push.")
        return PushResult(delivered=False)

    return PushResult(delivered=True)
