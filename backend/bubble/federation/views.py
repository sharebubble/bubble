"""Federation views.

Implements the ActivityPub discovery and actor endpoints:

  GET  /.well-known/webfinger        -> WebFinger actor lookup
  GET  /.well-known/nodeinfo         -> NodeInfo index
  GET  /.well-known/host-meta        -> XRD host-meta
  GET  /nodeinfo/2.1                 -> NodeInfo 2.1 document
  GET  /federation/instance-actor    -> Application actor JSON-LD
  GET  /federation/users/<username>  -> Person actor JSON-LD
  POST /federation/inbox             -> Shared inbox
  POST /federation/users/<username>/inbox  -> Per-user inbox
  GET  /federation/users/<username>/outbox
  GET  /federation/users/<username>/followers
  GET  /federation/users/<username>/following
  GET  /federation/users/<username>/featured
"""

from __future__ import annotations

import json
import logging
from urllib.parse import urlparse

from django.conf import settings
from django.contrib.auth import get_user_model
from django.http import Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django_ratelimit.decorators import ratelimit

from bubble.core.storage import absolute_media_url
from bubble.federation.actor_fetch import fetch_remote_actor
from bubble.federation.crypto import generate_and_store_keypair, verify_signature
from bubble.federation.models import (
    ActivityStatus,
    AllowlistState,
    DeliveryStatus,
    Follow,
    InboundActivity,
    InstanceActorKey,
    LocalActorKey,
    OutboundDelivery,
    RemoteInstance,
)
from bubble.federation.serializers import (
    booking_to_ap,
    item_to_ap,
    item_to_note_stub,
    message_to_ap,
)
from bubble.federation.tasks import process_inbound_activity
from bubble.items.models import Item

logger = logging.getLogger(__name__)

User = get_user_model()

AP_CONTENT_TYPE = "application/activity+json"
AP_LD_CONTENT_TYPE = (
    'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
)
AP_CONTEXT = [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/v1",
    "https://ns.sharebubble.org/v1",
    {
        # Mastodon-compat toot: vocabulary
        "toot": "http://joinmastodon.org/ns#",
        "Emoji": "toot:Emoji",
        "discoverable": "toot:discoverable",
        "indexable": "toot:indexable",
        "PropertyValue": "schema:PropertyValue",
        "value": "schema:value",
        "schema": "http://schema.org#",
    },
]

_AP_ACCEPTS = {AP_CONTENT_TYPE, "application/ld+json", "application/json"}

_ACCT_SPLIT = 2  # number of parts in "user@domain"


def _federation_enabled():
    return getattr(settings, "FEDERATION_ENABLED", False)


def _domain():
    return getattr(
        settings,
        "FEDERATION_DOMAIN",
        settings.ALLOWED_HOSTS[0] if settings.ALLOWED_HOSTS else "localhost",
    )


def _base_url():
    scheme = "http" if settings.DEBUG else "https"
    return f"{scheme}://{_domain()}"


def _ap_response(data: dict, status: int = 200) -> HttpResponse:
    """Return an ActivityPub JSON-LD response."""
    return HttpResponse(
        json.dumps(data, ensure_ascii=False),
        content_type=AP_CONTENT_TYPE,
        status=status,
    )


def _actor_uri(username: str) -> str:
    return f"{_base_url()}/federation/users/{username}"


def _instance_actor_uri() -> str:
    return f"{_base_url()}/federation/instance-actor"


def _public_key_block(key_id: str, owner_uri: str, pem: str) -> dict:
    return {
        "id": key_id,
        "owner": owner_uri,
        "publicKeyPem": pem,
    }


# ---------------------------------------------------------------------------
# Discovery endpoints
# ---------------------------------------------------------------------------


def webfinger(request):
    """RFC 7033 WebFinger endpoint.

    Handles ``acct:user@domain`` and plain actor URI resources.
    """
    if not _federation_enabled():
        raise Http404

    resource = request.GET.get("resource", "")
    if not resource:
        return HttpResponse(status=400)

    username = None
    if resource.startswith("acct:"):
        parts = resource[5:].split("@", 1)
        if len(parts) == _ACCT_SPLIT and parts[1] == _domain():
            username = parts[0]
    elif resource.startswith(_base_url() + "/federation/users/"):
        username = resource.split("/federation/users/", 1)[1].rstrip("/")

    if not username:
        return HttpResponse(status=404)

    try:
        user = User.objects.get(username=username, is_active=True)
    except User.DoesNotExist:
        return HttpResponse(status=404)

    # Respect per-user federation_discoverable flag
    if not getattr(user, "federation_enabled", True):
        return HttpResponse(status=404)
    try:
        profile = user.profile
        if not getattr(profile, "federation_discoverable", True):
            return HttpResponse(status=404)
    except Exception:  # noqa: BLE001
        logger.debug("Could not read profile for user %s", username)

    actor_uri = _actor_uri(user.username)
    data = {
        "subject": f"acct:{user.username}@{_domain()}",
        "aliases": [actor_uri],
        "links": [
            {
                "rel": "self",
                "type": AP_CONTENT_TYPE,
                "href": actor_uri,
            },
            {
                "rel": "http://webfinger.net/rel/profile-page",
                "type": "text/html",
                "href": f"{_base_url()}/u/{user.username}",
            },
        ],
    }
    return JsonResponse(data, content_type="application/jrd+json")


def nodeinfo_index(request):
    """NodeInfo discovery index at /.well-known/nodeinfo."""
    if not _federation_enabled():
        raise Http404

    data = {
        "links": [
            {
                "rel": "http://nodeinfo.diaspora.software/ns/schema/2.1",
                "href": f"{_base_url()}/nodeinfo/2.1",
            }
        ]
    }
    return JsonResponse(data)


def nodeinfo_21(request):
    """NodeInfo 2.1 document at /nodeinfo/2.1."""
    if not _federation_enabled():
        raise Http404

    user_count = User.objects.filter(is_active=True).count()
    instance_name = getattr(settings, "FEDERATION_INSTANCE_NAME", _domain())

    data = {
        "version": "2.1",
        "software": {
            "name": "bubble",
            "version": getattr(settings, "BUBBLE_VERSION", "0.1.0"),
            "repository": "https://github.com/sharebubble/bubble",
            "homepage": "https://sharebubble.org",
        },
        "protocols": ["activitypub"],
        "usage": {
            "users": {
                "total": user_count,
                "activeMonth": 0,
                "activeHalfyear": 0,
            },
            "localPosts": 0,
        },
        "openRegistrations": getattr(settings, "ACCOUNT_ALLOW_REGISTRATION", False),
        "metadata": {
            "nodeName": instance_name,
            "federation": {
                "enabled": True,
                "allowList": True,
            },
        },
    }
    return JsonResponse(
        data,
        content_type=(
            "application/json; profile=http://nodeinfo.diaspora.software/ns/schema/2.1#"
        ),
    )


def host_meta(request):
    """host-meta XRD document at /.well-known/host-meta."""
    if not _federation_enabled():
        raise Http404

    domain = _domain()
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">\n'
        f'  <Link rel="lrdd" type="application/xrd+xml"\n'
        f'        template="https://{domain}'
        '/.well-known/webfinger?resource={uri}"/>\n'
        "</XRD>"
    )
    return HttpResponse(xml, content_type="application/xrd+xml")


# ---------------------------------------------------------------------------
# Actor views
# ---------------------------------------------------------------------------


def instance_actor(request):
    """Return the instance-level Application actor."""
    if not _federation_enabled():
        raise Http404

    actor_uri = _instance_actor_uri()
    key_id = f"{actor_uri}#main-key"

    try:
        key = InstanceActorKey.load()
        public_key_pem = key.public_key_pem
    except Exception:
        logger.exception("Failed to load instance actor key")
        return HttpResponse(status=500)

    domain = _domain()
    instance_name = getattr(settings, "FEDERATION_INSTANCE_NAME", domain)

    data = {
        "@context": AP_CONTEXT,
        "id": actor_uri,
        "type": "Application",
        "preferredUsername": domain,
        "name": instance_name,
        "summary": f"Bubble instance at {domain}",
        "url": _base_url(),
        "inbox": f"{_base_url()}/federation/inbox",
        "outbox": f"{actor_uri}/outbox",
        "publicKey": _public_key_block(key_id, actor_uri, public_key_pem),
        "manuallyApprovesFollowers": True,
    }
    return _ap_response(data)


def _build_profile_attachment(user) -> list[dict]:
    """Build Mastodon-style ``PropertyValue`` attachment array for a user.

    Mastodon renders these as a table of name/value pairs on the profile.
    We expose: instance URL, join date, and (if available) location.
    """
    attachments = []

    def _prop(name: str, value: str) -> dict:
        return {
            "type": "PropertyValue",
            "name": name,
            "value": value,
        }

    attachments.append(_prop("Instance", _base_url()))

    joined = getattr(user, "date_joined", None)
    if joined:
        attachments.append(_prop("Joined", joined.strftime("%Y-%m-%d")))

    try:
        location = getattr(user.profile, "location", "") or ""
        if location:
            attachments.append(_prop("Location", location))
    except Exception:  # noqa: BLE001, S110
        pass

    return attachments


def person_actor(request, username: str):
    """Return a Person actor for a local user.

    Content-negotiates: AP clients get JSON-LD; browsers get redirected to
    the SPA profile page.
    """
    if not _federation_enabled():
        raise Http404

    accept = request.headers.get("accept", "")
    wants_ap = any(ct in accept for ct in _AP_ACCEPTS)
    if not wants_ap and "text/html" in accept:
        return redirect(f"{_base_url()}/u/{username}")

    user = get_object_or_404(User, username=username, is_active=True)

    if not getattr(user, "federation_enabled", True):
        raise Http404

    actor_uri = _actor_uri(username)
    key_id = f"{actor_uri}#main-key"

    try:
        key = LocalActorKey.objects.get(user=user)
    except LocalActorKey.DoesNotExist:
        key = generate_and_store_keypair(LocalActorKey, user=user)

    # Build multilingual summary
    try:
        profile = user.profile
        bio = profile.bio or ""
        avatar_url = (
            absolute_media_url(profile.profile_image) if profile.profile_image else None
        )
    except Exception:  # noqa: BLE001
        bio = ""
        avatar_url = None

    summary_map = {}
    if bio:
        lang = (
            getattr(getattr(user, "profile", None), "language", None)
            or settings.LANGUAGE_CODE
        )
        summary_map[lang] = bio

    data = {
        "@context": AP_CONTEXT,
        "id": actor_uri,
        "type": "Person",
        "preferredUsername": username,
        "name": getattr(user, "name", username) or username,
        "url": f"{_base_url()}/u/{username}",
        "summary": bio,
        **({"summaryMap": summary_map} if summary_map else {}),
        "inbox": f"{actor_uri}/inbox",
        "outbox": f"{actor_uri}/outbox",
        "followers": f"{actor_uri}/followers",
        "following": f"{actor_uri}/following",
        "featured": f"{actor_uri}/featured",
        "endpoints": {
            "sharedInbox": f"{_base_url()}/federation/inbox",
        },
        "publicKey": _public_key_block(key_id, actor_uri, key.public_key_pem),
        "manuallyApprovesFollowers": False,
        "discoverable": getattr(
            getattr(user, "profile", None), "federation_discoverable", True
        ),
        "indexable": False,
        # Mastodon-style profile metadata (PropertyValue attachment array)
        "attachment": _build_profile_attachment(user),
        **(
            {
                "icon": {
                    "type": "Image",
                    "url": avatar_url,
                    "mediaType": "image/jpeg",
                }
            }
            if avatar_url
            else {}
        ),
    }
    return _ap_response(data)


def person_followers(request, username: str):
    """Minimal followers OrderedCollection."""
    if not _federation_enabled():
        raise Http404
    get_object_or_404(User, username=username, is_active=True)
    actor_uri = _actor_uri(username)

    count = Follow.objects.filter(followee_ap_id=actor_uri, accepted=True).count()

    data = {
        "@context": "https://www.w3.org/ns/activitystreams",
        "id": f"{actor_uri}/followers",
        "type": "OrderedCollection",
        "totalItems": count,
        "first": f"{actor_uri}/followers?page=1",
    }
    return _ap_response(data)


def person_following(request, username: str):
    """Minimal following OrderedCollection."""
    if not _federation_enabled():
        raise Http404
    get_object_or_404(User, username=username, is_active=True)
    actor_uri = _actor_uri(username)

    count = Follow.objects.filter(follower_ap_id=actor_uri, accepted=True).count()

    data = {
        "@context": "https://www.w3.org/ns/activitystreams",
        "id": f"{actor_uri}/following",
        "type": "OrderedCollection",
        "totalItems": count,
        "first": f"{actor_uri}/following?page=1",
    }
    return _ap_response(data)


def person_featured(request, username: str):
    """Featured items collection (showcase items shown on Mastodon profile)."""
    if not _federation_enabled():
        raise Http404
    user = get_object_or_404(User, username=username, is_active=True)
    actor_uri = _actor_uri(username)

    items = Item.objects.filter(
        user=user,
        active=True,
        federation_visibility="public_federated",
    ).order_by("-created_at")[:5]

    ordered_items = [item_to_note_stub(item) for item in items]

    data = {
        "@context": "https://www.w3.org/ns/activitystreams",
        "id": f"{actor_uri}/featured",
        "type": "OrderedCollection",
        "totalItems": len(ordered_items),
        "orderedItems": ordered_items,
    }
    return _ap_response(data)


def person_outbox(request, username: str):
    """Paginated outbox — serves ``Create Item`` activities for the user.

    Query params:
      ``page`` (int, default 1) — 1-based page number
      ``page_size`` (int, default 20, max 100)
    """
    if not _federation_enabled():
        raise Http404
    user = get_object_or_404(User, username=username, is_active=True)
    actor_uri = _actor_uri(username)
    outbox_uri = f"{actor_uri}/outbox"

    raw_page = request.GET.get("page", "")
    if not raw_page:
        # Return the collection summary
        count = Item.objects.filter(
            user=user,
            active=True,
            federation_visibility="public_federated",
        ).count()
        data = {
            "@context": "https://www.w3.org/ns/activitystreams",
            "id": outbox_uri,
            "type": "OrderedCollection",
            "totalItems": count,
            "first": f"{outbox_uri}?page=1",
        }
        return _ap_response(data)

    # Paginated page
    try:
        page_num = max(1, int(raw_page))
    except (ValueError, TypeError):
        page_num = 1

    raw_size = request.GET.get("page_size", "20")
    try:
        page_size = min(100, max(1, int(raw_size)))
    except (ValueError, TypeError):
        page_size = 20

    offset = (page_num - 1) * page_size
    items_qs = Item.objects.filter(
        user=user,
        active=True,
        federation_visibility="public_federated",
    ).order_by("-created_at")[offset : offset + page_size + 1]

    items_list = list(items_qs)
    has_next = len(items_list) > page_size
    items_list = items_list[:page_size]

    from bubble.federation.serializers import item_to_create_activity  # noqa: PLC0415

    ordered_items = []
    for item in items_list:
        try:
            ordered_items.append(item_to_create_activity(item))
        except Exception:  # noqa: BLE001
            logger.debug(
                "person_outbox: failed to serialize item %s", item.pk, exc_info=True
            )

    data: dict = {
        "@context": "https://www.w3.org/ns/activitystreams",
        "id": f"{outbox_uri}?page={page_num}",
        "type": "OrderedCollectionPage",
        "partOf": outbox_uri,
        "orderedItems": ordered_items,
    }
    if has_next:
        data["next"] = f"{outbox_uri}?page={page_num + 1}&page_size={page_size}"
    if page_num > 1:
        data["prev"] = f"{outbox_uri}?page={page_num - 1}&page_size={page_size}"

    return _ap_response(data)


# ---------------------------------------------------------------------------
# Inbox views
# ---------------------------------------------------------------------------


def federation_health(request):
    """Federation health and metrics endpoint.

    Returns a JSON object with queue depths, delivery success rates, and
    instance connectivity stats. Intended for internal monitoring / ops use.
    Responds to any HTTP method; no authentication required (metrics are
    non-sensitive counts).
    """
    if not _federation_enabled():
        raise Http404

    from django.db.models import Count  # noqa: PLC0415

    # --- Outbound delivery stats ---
    delivery_qs = OutboundDelivery.objects.values("status").annotate(count=Count("id"))
    delivery_counts: dict[str, int] = {}
    for row in delivery_qs:
        delivery_counts[row["status"]] = row["count"]

    total_delivered = delivery_counts.get(DeliveryStatus.DELIVERED, 0)
    total_failed = delivery_counts.get(DeliveryStatus.FAILED, 0)
    total_dead = delivery_counts.get(DeliveryStatus.DEAD, 0)
    total_pending = delivery_counts.get(DeliveryStatus.PENDING, 0)
    total_deliveries = sum(delivery_counts.values())

    success_rate = (
        round(total_delivered / total_deliveries * 100, 1)
        if total_deliveries > 0
        else None
    )

    # --- Inbound activity stats ---
    inbound_qs = InboundActivity.objects.values("status").annotate(count=Count("ap_id"))
    inbound_counts: dict[str, int] = {}
    for row in inbound_qs:
        inbound_counts[row["status"]] = row["count"]

    # --- Instance / allowlist stats ---
    instances_allowed = RemoteInstance.objects.filter(
        allowlist_state=AllowlistState.ALLOWED
    ).count()
    instances_blocked = RemoteInstance.objects.filter(
        allowlist_state=AllowlistState.BLOCKED
    ).count()
    instances_pending = RemoteInstance.objects.filter(
        allowlist_state=AllowlistState.PENDING
    ).count()

    data = {
        "federation_enabled": True,
        "outbound": {
            "queue_depth": total_pending,
            "delivered": total_delivered,
            "failed": total_failed,
            "dead": total_dead,
            "success_rate_pct": success_rate,
        },
        "inbound": {
            "received": inbound_counts.get(ActivityStatus.RECEIVED, 0),
            "processed": inbound_counts.get(ActivityStatus.PROCESSED, 0),
            "failed": inbound_counts.get(ActivityStatus.FAILED, 0),
        },
        "instances": {
            "allowed": instances_allowed,
            "blocked": instances_blocked,
            "pending": instances_pending,
        },
    }
    return JsonResponse(data)


def _inbox_rate_limit_key(group, request):
    """Rate-limit key: prefer the AP actor URI from the JSON body, fall back to IP.

    Using the actor URI means a misbehaving remote instance is throttled as a
    unit even if it rotates IPs; IP fallback handles unsigned/malformed POSTs.
    """
    try:
        body = request.body
        data = json.loads(body)
        actor = data.get("actor", "")
        if actor:
            return actor
    except Exception:  # noqa: BLE001, S110
        pass
    return request.META.get("REMOTE_ADDR", "unknown")


_INBOX_RATE = getattr(settings, "FEDERATION_INBOX_RATE_LIMIT", "60/m")


@method_decorator(csrf_exempt, name="dispatch")
@method_decorator(
    ratelimit(key=_inbox_rate_limit_key, rate=_INBOX_RATE, method="POST", block=True),
    name="post",
)
class InboxView(View):
    """Shared or per-user ActivityPub inbox.

    Validates the HTTP Signature, checks the sender's instance is on the
    allowlist, deduplicates by activity id, then enqueues processing.
    """

    def post(self, request, username: str | None = None):  # noqa: PLR0911
        if not _federation_enabled():
            raise Http404

        # Parse body
        try:
            body = request.body
            activity = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return HttpResponse(status=400)

        actor_uri = activity.get("actor", "")
        activity_id = activity.get("id", "")
        activity_type = activity.get("type", "")

        if not actor_uri or not activity_id or not activity_type:
            return HttpResponse(status=400)

        # --- Idempotency check ---
        if InboundActivity.objects.filter(ap_id=activity_id).exists():
            return HttpResponse(status=202)

        # --- Allowlist check ---
        sender_domain = urlparse(actor_uri).netloc
        try:
            instance = RemoteInstance.objects.get(domain=sender_domain)
            if not instance.is_allowed:
                return HttpResponse(status=403)
        except RemoteInstance.DoesNotExist:
            return HttpResponse(status=403)

        # --- HTTP Signature verification ---
        if not self._verify_signature(request, body, actor_uri):
            return HttpResponse(status=401)

        # --- Log and enqueue ---
        InboundActivity.objects.create(
            ap_id=activity_id,
            activity_type=activity_type,
            actor_uri=actor_uri,
            raw_jsonld=activity,
        )
        process_inbound_activity(activity_id)

        return HttpResponse(status=202)

    def _verify_signature(self, request, body: bytes, actor_uri: str) -> bool:
        try:
            actor = fetch_remote_actor(actor_uri)
        except Exception:  # noqa: BLE001
            logger.debug(
                "Could not fetch actor for signature verification: %s",
                actor_uri,
            )
            return False

        key_id = request.headers.get("signature", "")
        if not key_id:
            return False

        headers = {
            k.lower().replace("http_", "", 1).replace("_", "-"): v
            for k, v in request.META.items()
            if k.startswith("HTTP_")
        }
        headers["content-type"] = request.content_type or ""

        return verify_signature(
            method=request.method,
            url=request.build_absolute_uri(),
            headers=headers,
            body=body,
            public_key_pem=actor.public_key_pem,
            key_id=f"{actor_uri}#main-key",
        )


# ---------------------------------------------------------------------------
# AP object endpoints — dereferenceable URIs for items, bookings, messages
# ---------------------------------------------------------------------------


def item_ap_object(request, pk: str):
    """Return a ``bubble:Item`` AP object for a local item.

    Only serves items whose ``federation_visibility`` is ``public_federated``
    and whose owner has federation enabled.
    """
    if not _federation_enabled():
        raise Http404

    item = get_object_or_404(
        Item,
        pk=pk,
        federation_visibility="public_federated",
        active=True,
    )
    if not getattr(item.user, "federation_enabled", True):
        raise Http404

    accept = request.headers.get("accept", "")
    wants_ap = any(ct in accept for ct in _AP_ACCEPTS)
    if not wants_ap and "text/html" in accept:
        return redirect(f"{_base_url()}/items/{pk}")

    doc = item_to_ap(item)
    doc["@context"] = AP_CONTEXT
    return _ap_response(doc)


def booking_ap_object(request, pk: str):
    """Return a ``bubble:BookingProposal`` AP object for a local booking.

    Access is restricted: only the item owner or the booker (if local) may
    dereference this URI without HTTP Signature auth. For simplicity in v1 we
    require the remote peer to be on the allowlist (checked via the Signature
    verification path in the InboxView); this endpoint is primarily used so
    remote instances can dereference the booking URI we publish in activities.

    We do NOT gate on auth here — the content (booking metadata) is already
    visible to both parties through the activity payload; dereferencing just
    confirms the current state.
    """
    if not _federation_enabled():
        raise Http404

    from bubble.bookings.models import Booking  # noqa: PLC0415

    booking = get_object_or_404(Booking, pk=pk)

    # Only serve if at least one side is federated
    if not booking.ap_id and not booking.remote_booker_actor_id:
        raise Http404

    doc = booking_to_ap(booking)
    return _ap_response(doc)


def message_ap_object(request, pk: str):
    """Return an AP ``Note`` for a local booking message."""
    if not _federation_enabled():
        raise Http404

    from bubble.bookings.models import Message  # noqa: PLC0415

    message = get_object_or_404(Message, pk=pk)

    # Only serve federated messages
    if not message.ap_id and not message.remote_sender_actor_id:
        raise Http404

    doc = message_to_ap(message)
    return _ap_response(doc)
