"""Federation Huey tasks.

Handles asynchronous processing of inbound and outbound activities.
"""

from __future__ import annotations

import contextlib
import datetime
import json
import logging
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse

import httpx
from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone
from huey.contrib.djhuey import db_task

from bubble.federation.actor_fetch import fetch_remote_actor
from bubble.federation.crypto import (
    decrypt_private_key,
    get_or_create_user_key,
    sign_request,
)
from bubble.federation.models import (
    ActivityStatus,
    AllowlistState,  # noqa: F401 - re-exported for convenience
    DeliveryStatus,
    Follow,
    InboundActivity,
    InstanceActorKey,
    OutboundDelivery,
    RemoteActor,
    RemoteFavorite,
    RemoteInstance,
    RemoteItem,
    RemoteItemImage,
)
from bubble.items.models import Item

logger = logging.getLogger(__name__)


@db_task(retries=3, retry_delay=60)
def process_inbound_activity(activity_id: str):
    """Process a previously logged inbound activity by its AP id.

    Dispatches to the appropriate handler based on activity type.
    """
    try:
        record = InboundActivity.objects.get(ap_id=activity_id)
    except InboundActivity.DoesNotExist:
        logger.warning("InboundActivity not found: %s", activity_id)
        return

    record.status = ActivityStatus.PROCESSING
    record.save(update_fields=["status"])

    try:
        _dispatch_activity(record.raw_jsonld)
        record.status = ActivityStatus.PROCESSED
        record.processed_at = timezone.now()
    except Exception as exc:
        record.status = ActivityStatus.FAILED
        record.error = str(exc)
        logger.exception("Failed to process activity %s", activity_id)
    finally:
        record.save(update_fields=["status", "processed_at", "error"])


def _dispatch_activity(activity: dict):
    """Route an activity dict to the correct handler."""
    activity_type = activity.get("type", "")
    obj = activity.get("object", {})
    obj_type = obj.get("type", "") if isinstance(obj, dict) else ""

    handlers = {
        ("Create", "bubble:Item"): _handle_create_item,
        ("Create", "Item"): _handle_create_item,
        ("Update", "bubble:Item"): _handle_update_item,
        ("Update", "Item"): _handle_update_item,
        ("Delete", "bubble:Item"): _handle_delete_item,
        ("Delete", "Item"): _handle_delete_item,
        ("Offer", "bubble:BookingProposal"): _handle_offer_booking,
        ("Offer", "BookingProposal"): _handle_offer_booking,
        ("Accept", "bubble:BookingProposal"): _handle_accept_booking,
        ("Accept", "BookingProposal"): _handle_accept_booking,
        ("Reject", "bubble:BookingProposal"): _handle_reject_booking,
        ("Reject", "BookingProposal"): _handle_reject_booking,
        ("TentativeAccept", "bubble:BookingProposal"): _handle_tentative_accept_booking,
        ("TentativeAccept", "BookingProposal"): _handle_tentative_accept_booking,
        ("Undo", "bubble:BookingProposal"): _handle_cancel_booking,
        ("Undo", "BookingProposal"): _handle_cancel_booking,
        ("Create", "Note"): _handle_note_message,
        ("Follow", ""): _handle_follow,
        ("Undo", "Follow"): _handle_undo_follow,
        ("Accept", "Follow"): _handle_accept_follow,
        ("Like", ""): _handle_like,
        ("Undo", "Like"): _handle_undo_like,
        ("Delete", "Person"): _handle_delete_person,
    }

    handler = handlers.get((activity_type, obj_type))
    if handler:
        handler(activity)
    else:
        logger.debug(
            "No handler for activity type=%s obj_type=%s", activity_type, obj_type
        )


# ---------------------------------------------------------------------------
# Activity handlers
# ---------------------------------------------------------------------------


def _handle_create_item(activity: dict):
    """Create or update a RemoteItem from a Create/Item activity."""
    _upsert_remote_item(activity.get("object", {}))


def _handle_update_item(activity: dict):
    """Update an existing RemoteItem."""
    _upsert_remote_item(activity.get("object", {}))


def _upsert_remote_item(obj: dict):
    """Create or update a RemoteItem (and its images) from an AP Item object."""
    if not isinstance(obj, dict):
        return

    ap_id = obj.get("id", "")
    if not ap_id:
        logger.warning("Received Item object without id -- skipping")
        return

    actor_uri = obj.get("attributedTo", "")
    if not actor_uri:
        logger.warning("Item %s has no attributedTo -- skipping", ap_id)
        return

    try:
        actor = fetch_remote_actor(actor_uri)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Could not fetch actor %s for item %s: %s", actor_uri, ap_id, exc
        )
        return

    # Parse price
    price = None
    price_currency = ""
    raw_price = obj.get("schema:price") or obj.get("price")
    if raw_price:
        with contextlib.suppress(InvalidOperation):
            price = Decimal(str(raw_price))
    price_currency = obj.get("schema:priceCurrency") or obj.get("priceCurrency") or ""

    defaults = {
        "remote_actor": actor,
        "instance": actor.instance,
        "name": obj.get("name") or obj.get("nameMap", {}).get("en", ""),
        "description": (obj.get("content") or obj.get("contentMap", {}).get("en", "")),
        "category": obj.get("bubble:category") or obj.get("category", ""),
        "sales_type": obj.get("bubble:salesType") or obj.get("salesType", ""),
        "condition": obj.get("bubble:condition") or obj.get("condition", ""),
        "status": obj.get("bubble:itemStatus") or obj.get("itemStatus", ""),
        "price": price,
        "price_currency": price_currency,
        "properties": (obj.get("bubble:properties") or obj.get("properties") or {}),
        "raw_jsonld": obj,
        "deleted": False,
        "deleted_at": None,
    }

    remote_item, _ = RemoteItem.objects.update_or_create(ap_id=ap_id, defaults=defaults)

    # Sync image attachments
    attachments = obj.get("attachment") or []
    if attachments:
        RemoteItemImage.objects.filter(remote_item=remote_item).delete()
        for idx, att in enumerate(attachments):
            if not isinstance(att, dict):
                continue
            url = att.get("url", "")
            if url:
                RemoteItemImage.objects.create(
                    remote_item=remote_item,
                    ordering=idx,
                    url=url,
                    alt=att.get("name", ""),
                )


def _handle_delete_item(activity: dict):
    """Soft-delete a RemoteItem."""
    obj = activity.get("object", {})
    ap_id = obj.get("id", obj) if isinstance(obj, dict) else obj
    RemoteItem.objects.filter(ap_id=ap_id).update(
        deleted=True, deleted_at=timezone.now()
    )


# ---------------------------------------------------------------------------
# Booking inbound handlers
# ---------------------------------------------------------------------------


def _resolve_local_item_from_uri(item_uri: str):
    """Return a local Item for *item_uri*, or raise Item.DoesNotExist."""
    path = urlparse(item_uri).path
    item_uuid = path.rstrip("/").split("/")[-1]
    return Item.objects.get(pk=item_uuid)


def _handle_offer_booking(activity: dict):
    """Create a local Booking from an inbound ``Offer`` activity."""
    from decimal import Decimal, InvalidOperation  # noqa: PLC0415

    from bubble.bookings.models import Booking, BookingStatus  # noqa: PLC0415

    obj = activity.get("object", {})
    if not isinstance(obj, dict):
        return

    ap_id = obj.get("id", "")
    actor_uri = activity.get("actor", "")

    if not ap_id or not actor_uri:
        logger.warning("_handle_offer_booking: missing id or actor")
        return

    # Avoid creating duplicates
    if Booking.objects.filter(ap_id=ap_id).exists():
        logger.debug("Booking %s already exists -- skipping", ap_id)
        return

    item_uri = obj.get("object", "")
    if isinstance(item_uri, dict):
        item_uri = item_uri.get("id", "")

    try:
        item = _resolve_local_item_from_uri(item_uri)
    except Item.DoesNotExist:
        logger.warning("_handle_offer_booking: local item not found for %s", item_uri)
        return

    try:
        remote_actor = fetch_remote_actor(actor_uri)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "_handle_offer_booking: could not fetch actor %s: %s", actor_uri, exc
        )
        return

    offer_amount = None
    offer_currency = "EUR"
    raw_price = obj.get("schema:price")
    if raw_price:
        with contextlib.suppress(InvalidOperation):
            offer_amount = Decimal(str(raw_price))
    offer_currency = obj.get("schema:priceCurrency") or offer_currency

    from dateutil.parser import parse as parse_dt  # noqa: PLC0415

    time_from = None
    time_to = None
    with contextlib.suppress(Exception):
        if obj.get("startTime"):
            time_from = parse_dt(obj["startTime"])
    with contextlib.suppress(Exception):
        if obj.get("endTime"):
            time_to = parse_dt(obj["endTime"])

    booking = Booking(
        item=item,
        remote_booker_actor=remote_actor,
        status=BookingStatus.PENDING,
        ap_id=ap_id,
        time_from=time_from,
        time_to=time_to,
    )
    if offer_amount is not None:
        from djmoney.money import Money  # noqa: PLC0415

        booking.offer = Money(offer_amount, offer_currency)

    # Disable the outbound federation signal for this save (inbound path)
    booking._skip_federation_signal = True  # noqa: SLF001
    booking.save()
    logger.info("Created local booking %s from remote actor %s", booking.pk, actor_uri)

    # Notify the local item owner via WebSocket
    _notify_item_owner_new_booking(booking)


def _handle_accept_booking(activity: dict):
    """Mark a local Booking as CONFIRMED from an inbound ``Accept``."""
    from bubble.bookings.models import Booking, BookingStatus  # noqa: PLC0415

    booking_uri = activity.get("object", "")
    if isinstance(booking_uri, dict):
        booking_uri = booking_uri.get("id", "")

    path = urlparse(booking_uri).path
    booking_uuid = path.rstrip("/").split("/")[-1]

    try:
        booking = Booking.objects.get(pk=booking_uuid)
    except Booking.DoesNotExist:
        logger.warning("_handle_accept_booking: booking %s not found", booking_uuid)
        return

    booking._skip_federation_signal = True  # noqa: SLF001
    booking.status = BookingStatus.CONFIRMED
    booking.save(update_fields=["status", "updated_at"])
    logger.info("Booking %s confirmed via federation", booking_uuid)


def _handle_reject_booking(activity: dict):
    """Mark a local Booking as REJECTED from an inbound ``Reject``."""
    from bubble.bookings.models import Booking, BookingStatus  # noqa: PLC0415

    booking_uri = activity.get("object", "")
    if isinstance(booking_uri, dict):
        booking_uri = booking_uri.get("id", "")

    path = urlparse(booking_uri).path
    booking_uuid = path.rstrip("/").split("/")[-1]

    try:
        booking = Booking.objects.get(pk=booking_uuid)
    except Booking.DoesNotExist:
        logger.warning("_handle_reject_booking: booking %s not found", booking_uuid)
        return

    booking._skip_federation_signal = True  # noqa: SLF001
    booking.status = BookingStatus.REJECTED
    booking.save(update_fields=["status", "updated_at"])
    logger.info("Booking %s rejected via federation", booking_uuid)


def _handle_tentative_accept_booking(activity: dict):
    """Store a counter-offer on a local Booking from a ``TentativeAccept``."""
    from decimal import Decimal, InvalidOperation  # noqa: PLC0415

    from bubble.bookings.models import Booking  # noqa: PLC0415

    obj = activity.get("object", {})
    if not isinstance(obj, dict):
        return

    booking_uri = obj.get("id", "")
    path = urlparse(booking_uri).path
    booking_uuid = path.rstrip("/").split("/")[-1]

    try:
        booking = Booking.objects.get(pk=booking_uuid)
    except Booking.DoesNotExist:
        logger.warning(
            "_handle_tentative_accept_booking: booking %s not found", booking_uuid
        )
        return

    raw_counter = obj.get("bubble:counterOffer")
    counter_currency = obj.get("bubble:counterOfferCurrency") or "EUR"
    if raw_counter:
        with contextlib.suppress(InvalidOperation):
            amount = Decimal(str(raw_counter))
            from djmoney.money import Money  # noqa: PLC0415

            booking.counter_offer = Money(amount, counter_currency)

    booking._skip_federation_signal = True  # noqa: SLF001
    booking.save(
        update_fields=["counter_offer", "counter_offer_currency", "updated_at"]
    )
    logger.info("Counter-offer stored on booking %s via federation", booking_uuid)


def _handle_cancel_booking(activity: dict):
    """Mark a local Booking as CANCELLED from an inbound ``Undo``."""
    from bubble.bookings.models import Booking, BookingStatus  # noqa: PLC0415

    booking_uri = activity.get("object", "")
    if isinstance(booking_uri, dict):
        booking_uri = booking_uri.get("id", "")

    path = urlparse(booking_uri).path
    booking_uuid = path.rstrip("/").split("/")[-1]

    try:
        booking = Booking.objects.get(pk=booking_uuid)
    except Booking.DoesNotExist:
        logger.warning("_handle_cancel_booking: booking %s not found", booking_uuid)
        return

    booking._skip_federation_signal = True  # noqa: SLF001
    booking.status = BookingStatus.CANCELLED
    booking.save(update_fields=["status", "updated_at"])
    logger.info("Booking %s cancelled via federation", booking_uuid)


# ---------------------------------------------------------------------------
# WebSocket notification helpers for inbound federation events
# ---------------------------------------------------------------------------


def _notify_item_owner_new_booking(booking) -> None:
    """Send a WS notification to each local user with change_item perm."""
    try:
        from django.utils.translation import gettext as _  # noqa: PLC0415
        from guardian.shortcuts import get_users_with_perms  # noqa: PLC0415

        from bubble.core.websocket_signals import (  # noqa: PLC0415
            send_message_notification,
        )

        item = booking.item
        users_with_perms = get_users_with_perms(
            item, only_with_perms_in=["change_item"], with_group_users=False
        )
        local_booker_id = booking.user_id
        for user in users_with_perms:
            if user.id != local_booker_id:
                send_message_notification(
                    user.id,
                    message=_(
                        "A new booking has been created for your item (via federation)."
                    ),
                )
                logger.debug(
                    "Sent federated new-booking WS notification to user %s", user.pk
                )
    except Exception:  # noqa: BLE001
        logger.debug(
            "Failed to send WS notification for federated booking %s",
            booking.pk,
            exc_info=True,
        )


def _notify_booking_participants_new_message(message) -> None:
    """Send a WS notification to local participants in the booking thread."""
    try:
        from guardian.shortcuts import get_users_with_perms  # noqa: PLC0415

        from bubble.core.websocket_signals import (  # noqa: PLC0415
            send_message_notification,
        )

        booking = message.booking
        item = booking.item
        local_booker = booking.user

        # Remote sender → notify all local item owners
        if message.remote_sender_actor:
            users_with_perms = get_users_with_perms(
                item, only_with_perms_in=["change_item"], with_group_users=False
            )
            for user in users_with_perms:
                send_message_notification(
                    user.id,
                    message=message.message,
                    booking_uuid=str(booking.id),
                )
                logger.debug(
                    "Sent federated message WS notification to owner %s", user.pk
                )
        elif message.sender and local_booker:
            # Local sender (item owner) replying → notify the booker if local
            if message.sender != local_booker:
                send_message_notification(
                    local_booker.id,
                    message=message.message,
                    booking_uuid=str(booking.id),
                )
    except Exception:  # noqa: BLE001
        logger.debug(
            "Failed to send WS notification for federated message %s",
            message.pk,
            exc_info=True,
        )


# ---------------------------------------------------------------------------
# Message inbound handler
# ---------------------------------------------------------------------------


def _handle_note_message(activity: dict):
    """Create a local Message from an inbound ``Create Note`` activity."""
    from bubble.bookings.models import Booking, Message  # noqa: PLC0415

    obj = activity.get("object", {})
    if not isinstance(obj, dict):
        return

    ap_id = obj.get("id", "")
    actor_uri = activity.get("actor", "")

    if not ap_id:
        logger.warning("_handle_note_message: missing Note id")
        return

    # Avoid duplicates
    if Message.objects.filter(ap_id=ap_id).exists():
        logger.debug("Message %s already exists -- skipping", ap_id)
        return

    # Note must reference a booking via inReplyTo
    booking_uri = obj.get("inReplyTo", "")
    if not booking_uri:
        logger.debug("_handle_note_message: Note has no inReplyTo -- ignoring")
        return

    path = urlparse(booking_uri).path
    booking_uuid = path.rstrip("/").split("/")[-1]

    try:
        booking = Booking.objects.get(pk=booking_uuid)
    except Booking.DoesNotExist:
        logger.warning("_handle_note_message: booking %s not found", booking_uuid)
        return

    try:
        remote_actor = fetch_remote_actor(actor_uri)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "_handle_note_message: could not fetch actor %s: %s", actor_uri, exc
        )
        return

    content = obj.get("content", "")

    msg = Message(
        booking=booking,
        remote_sender_actor=remote_actor,
        ap_id=ap_id,
        message=content,
    )
    msg._skip_federation_signal = True  # noqa: SLF001
    msg.save()
    logger.info("Created local message %s from remote actor %s", msg.pk, actor_uri)

    # Notify the local item owner (or local booker, if owner sent the message)
    _notify_booking_participants_new_message(msg)


def _handle_follow(activity: dict):
    """Handle an inbound Follow activity -- auto-accept for allowed instances."""
    follower_uri = activity.get("actor", "")
    followee_uri = activity.get("object", "")
    if isinstance(followee_uri, dict):
        followee_uri = followee_uri.get("id", "")

    follow, created = Follow.objects.get_or_create(
        follower_ap_id=follower_uri,
        followee_ap_id=followee_uri,
        defaults={"accepted": True},  # auto-accept from allowlisted instances
    )
    if not created and not follow.accepted:
        follow.accepted = True
        follow.save(update_fields=["accepted"])


def _handle_undo_follow(activity: dict):
    """Handle an Undo Follow activity."""
    obj = activity.get("object", {})
    follower_uri = activity.get("actor", "")
    followee_uri = obj.get("object", "") if isinstance(obj, dict) else ""
    Follow.objects.filter(
        follower_ap_id=follower_uri, followee_ap_id=followee_uri
    ).delete()


def _handle_accept_follow(activity: dict):
    """Handle an Accept Follow activity."""
    obj = activity.get("object", {})
    follower_uri = obj.get("actor", "") if isinstance(obj, dict) else ""
    followee_uri = activity.get("actor", "")
    Follow.objects.filter(
        follower_ap_id=follower_uri, followee_ap_id=followee_uri
    ).update(accepted=True)


def _handle_like(activity: dict):
    """Handle a Like activity on a local item."""
    actor_uri = activity.get("actor", "")
    obj = activity.get("object", "")
    item_uri = obj if isinstance(obj, str) else obj.get("id", "")

    # Derive item UUID from the URI
    try:
        path = urlparse(item_uri).path
        item_uuid = path.rstrip("/").split("/")[-1]
        item = Item.objects.get(pk=item_uuid)
    except Exception:  # noqa: BLE001
        return

    try:
        actor = fetch_remote_actor(actor_uri)
    except Exception:  # noqa: BLE001
        return

    RemoteFavorite.objects.get_or_create(remote_actor=actor, item=item)


def _handle_undo_like(activity: dict):
    """Handle an Undo Like activity."""
    actor_uri = activity.get("actor", "")
    obj = activity.get("object", {})
    item_uri = obj.get("object", "") if isinstance(obj, dict) else ""
    item_uri = item_uri if isinstance(item_uri, str) else item_uri.get("id", "")

    try:
        path = urlparse(item_uri).path
        item_uuid = path.rstrip("/").split("/")[-1]
        actor = RemoteActor.objects.get(ap_id=actor_uri)
        RemoteFavorite.objects.filter(remote_actor=actor, item_id=item_uuid).delete()
    except Exception:  # noqa: BLE001
        logger.debug("_handle_undo_like failed silently", exc_info=True)


def _handle_delete_person(activity: dict):
    """Soft-delete a RemoteActor and their items when a Delete Person arrives."""
    actor_uri = activity.get("object", "")
    if isinstance(actor_uri, dict):
        actor_uri = actor_uri.get("id", "")

    RemoteActor.objects.filter(ap_id=actor_uri).update(deleted=True)
    RemoteItem.objects.filter(remote_actor__ap_id=actor_uri).update(
        deleted=True, deleted_at=timezone.now()
    )


# ---------------------------------------------------------------------------
# Outbound delivery
# ---------------------------------------------------------------------------


def _resolve_signing_key(signing_uri: str, instance_uri: str):
    """Return the key record to sign *signing_uri*'s outbound activity."""
    if signing_uri == instance_uri:
        return InstanceActorKey.load()

    username = urlparse(signing_uri).path.rstrip("/").split("/")[-1]
    try:
        user_model = get_user_model()
        user = user_model.objects.get(username=username)
        return get_or_create_user_key(user)
    except Exception:  # noqa: BLE001
        return InstanceActorKey.load()


def _instance_actor_uri() -> str:
    domain = getattr(settings, "FEDERATION_DOMAIN", "") or settings.ALLOWED_HOSTS[0]
    scheme = "http" if settings.DEBUG else "https"
    return f"{scheme}://{domain}/federation/actor"


@db_task(retries=8, retry_delay=60)
def deliver_activity(delivery_id: str):
    """Attempt to deliver an OutboundDelivery to its recipient inbox."""
    try:
        delivery = OutboundDelivery.objects.get(id=delivery_id)
    except OutboundDelivery.DoesNotExist:
        return

    delivery.attempt += 1
    delivery.save(update_fields=["attempt"])

    key_record = _resolve_signing_key(delivery.signing_actor_uri, _instance_actor_uri())
    private_key = decrypt_private_key(key_record.private_key_encrypted)

    body = json.dumps(delivery.payload, ensure_ascii=False).encode()

    signed_headers = sign_request(
        method="POST",
        url=delivery.recipient_inbox,
        headers={"Content-Type": "application/activity+json"},
        body=body,
        private_key=private_key,
        key_id=f"{delivery.signing_actor_uri}#main-key",
    )

    try:
        response = httpx.post(
            delivery.recipient_inbox,
            content=body,
            headers=signed_headers,
            timeout=getattr(settings, "FEDERATION_DELIVERY_TIMEOUT", 10),
        )
        if response.status_code in (200, 201, 202):
            delivery.status = DeliveryStatus.DELIVERED
        else:
            delivery.status = DeliveryStatus.FAILED
            delivery.last_error = f"HTTP {response.status_code}: {response.text[:500]}"
    except httpx.HTTPError as exc:
        max_retries = getattr(settings, "FEDERATION_DELIVERY_MAX_RETRIES", 8)
        if delivery.attempt >= max_retries:
            delivery.status = DeliveryStatus.DEAD
        else:
            delivery.status = DeliveryStatus.FAILED
            # Exponential back-off: 1m, 5m, 30m, 2h, 6h, 12h, 24h, 48h
            delays = [60, 300, 1800, 7200, 21600, 43200, 86400, 172800]
            delay = delays[min(delivery.attempt - 1, len(delays) - 1)]
            delivery.next_attempt_at = timezone.now() + datetime.timedelta(
                seconds=delay
            )
        delivery.last_error = str(exc)
        logger.warning(
            "Delivery %s failed (attempt %d): %s",
            delivery_id,
            delivery.attempt,
            exc,
        )

    delivery.save(
        update_fields=["status", "last_error", "next_attempt_at", "updated_at"]
    )


# ---------------------------------------------------------------------------
# Backfill task — import remote catalog when an instance is allowlisted
# ---------------------------------------------------------------------------

_BACKFILL_PAGE_SIZE = 20
_BACKFILL_MAX_PAGES = 100  # hard cap per backfill run (~2 000 items)
_BACKFILL_THROTTLE_SECONDS = 2  # polite delay between page fetches


@db_task(retries=2, retry_delay=300)
def backfill_remote_catalog(domain: str):
    """Paginate a remote instance's public item catalog and upsert all items.

    Called automatically when an admin allows a remote instance.  Uses the
    instance's ``catalog_url`` if set; otherwise falls back to deriving it
    from the remote instance actor's outbox.

    The task is throttled (``_BACKFILL_THROTTLE_SECONDS`` between pages) and
    capped at ``_BACKFILL_MAX_PAGES`` pages to avoid overwhelming the peer.
    """
    import time  # noqa: PLC0415

    try:
        instance = RemoteInstance.objects.get(domain=domain)
    except RemoteInstance.DoesNotExist:
        logger.warning("backfill_remote_catalog: instance %s not found", domain)
        return

    if not instance.is_allowed:
        logger.info(
            "backfill_remote_catalog: %s is no longer allowed, skipping", domain
        )
        return

    # Determine the starting URL for the catalog
    catalog_url = instance.catalog_url or _derive_catalog_url(domain)
    if not catalog_url:
        logger.warning(
            "backfill_remote_catalog: no catalog URL for %s — skipping", domain
        )
        return

    logger.info("Starting backfill for %s from %s", domain, catalog_url)

    # Resolve the collection first page
    next_url: str | None = _resolve_collection_first(catalog_url)
    pages_fetched = 0
    items_upserted = 0

    while next_url and pages_fetched < _BACKFILL_MAX_PAGES:
        if pages_fetched > 0:
            time.sleep(_BACKFILL_THROTTLE_SECONDS)

        try:
            resp = httpx.get(
                next_url,
                headers={"Accept": "application/activity+json"},
                timeout=getattr(settings, "FEDERATION_DELIVERY_TIMEOUT", 10),
                follow_redirects=True,
            )
            resp.raise_for_status()
            page = resp.json()
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "backfill_remote_catalog: failed to fetch page %s: %s", next_url, exc
            )
            break

        items_on_page = page.get("orderedItems") or page.get("items") or []
        for activity in items_on_page:
            if not isinstance(activity, dict):
                continue
            activity_type = activity.get("type", "")
            obj = activity.get("object", {})
            obj_type = obj.get("type", "") if isinstance(obj, dict) else ""

            if activity_type in ("Create", "Update") and obj_type in (
                "bubble:Item",
                "Item",
            ):
                try:
                    _upsert_remote_item(obj)
                    items_upserted += 1
                except Exception:  # noqa: BLE001
                    logger.debug(
                        "backfill: failed to upsert item %s",
                        obj.get("id"),
                        exc_info=True,
                    )

        pages_fetched += 1
        next_url = _next_page_url(page)

    logger.info(
        "Backfill complete for %s: %d pages, %d items upserted",
        domain,
        pages_fetched,
        items_upserted,
    )


def _derive_catalog_url(domain: str) -> str:
    """Derive the outbox URL for a Bubble peer instance from its domain."""
    scheme = "https"
    # Construct the instance-actor URI: https://<domain>/federation/instance-actor
    instance_actor_uri = f"{scheme}://{domain}/federation/instance-actor"
    try:
        resp = httpx.get(
            instance_actor_uri,
            headers={"Accept": "application/activity+json"},
            timeout=10,
            follow_redirects=True,
        )
        resp.raise_for_status()
        actor = resp.json()
        outbox = actor.get("outbox", "")
        if outbox:
            return outbox
    except Exception:  # noqa: BLE001
        logger.debug(
            "_derive_catalog_url: could not fetch instance actor for %s",
            domain,
            exc_info=True,
        )
    return ""


def _resolve_collection_first(collection_url: str) -> str | None:
    """Fetch a collection URL and return the first-page URL."""
    try:
        resp = httpx.get(
            collection_url,
            headers={"Accept": "application/activity+json"},
            timeout=10,
            follow_redirects=True,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:  # noqa: BLE001
        logger.debug(
            "_resolve_collection_first: failed to fetch %s",
            collection_url,
            exc_info=True,
        )
        return None
    else:
        # If it already is a page, use it directly
        if data.get("type") in ("OrderedCollectionPage", "CollectionPage"):
            return collection_url
        first = data.get("first", "")
        if isinstance(first, dict):
            first = first.get("id", "")
        return first or None


def _next_page_url(page: dict) -> str | None:
    """Extract the ``next`` page URL from an AP collection page."""
    nxt = page.get("next", "")
    if isinstance(nxt, dict):
        nxt = nxt.get("id", "")
    return nxt or None
