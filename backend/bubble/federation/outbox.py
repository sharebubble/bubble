"""Outbound federation helpers.

High-level functions that:
1. Build an AP activity from a local model instance.
2. Resolve recipient inboxes from the allowlist (broadcast) or point-to-point.
3. Create ``OutboundDelivery`` rows.
4. Enqueue the ``deliver_activity`` Huey task.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from django.conf import settings

from bubble.federation.models import (
    AllowlistState,
    OutboundDelivery,
    RemoteActor,
    RemoteInstance,
)
from bubble.federation.serializers import (
    _base_url as _serializer_base_url,
)
from bubble.federation.serializers import (
    booking_to_accept_activity,
    booking_to_cancel_activity,
    booking_to_offer_activity,
    booking_to_reject_activity,
    booking_to_tentative_accept_activity,
    item_to_create_activity,
    item_to_delete_activity,
    item_to_update_activity,
    message_to_create_activity,
)
from bubble.federation.tasks import deliver_activity

if TYPE_CHECKING:
    from bubble.bookings.models import Booking, Message
    from bubble.items.models import Item

logger = logging.getLogger(__name__)


def _federation_enabled() -> bool:
    return getattr(settings, "FEDERATION_ENABLED", False)


def _base_url() -> str:
    return _serializer_base_url()


def _instance_actor_uri() -> str:
    domain = getattr(settings, "FEDERATION_DOMAIN", "") or settings.ALLOWED_HOSTS[0]
    scheme = "http" if settings.DEBUG else "https"
    return f"{scheme}://{domain}/federation/actor"


def _collect_broadcast_inboxes() -> list[str]:
    """Return de-duplicated inboxes for all allowed remote instances (broadcast)."""
    inboxes: set[str] = set()
    allowed_instances = RemoteInstance.objects.filter(
        allowlist_state=AllowlistState.ALLOWED
    )
    for instance in allowed_instances:
        if instance.inbox_url:
            inboxes.add(instance.inbox_url)
        else:
            for shared, personal in RemoteActor.objects.filter(
                instance=instance, deleted=False
            ).values_list("shared_inbox_url", "inbox_url"):
                inboxes.add(shared or personal)
    return list(inboxes)


def _inbox_for_actor_uri(actor_uri: str) -> str | None:
    """Return the best inbox URL for a known remote actor URI, or None."""
    try:
        actor = RemoteActor.objects.get(ap_id=actor_uri, deleted=False)
    except RemoteActor.DoesNotExist:
        return None
    else:
        return actor.shared_inbox_url or actor.inbox_url


def _enqueue_to_inboxes(
    activity: dict,
    signing_actor_uri: str,
    inboxes: list[str],
) -> None:
    """Persist OutboundDelivery rows for *inboxes* and schedule Huey tasks."""
    if not inboxes:
        logger.debug("No recipient inboxes -- skipping outbound delivery")
        return

    activity_id = activity.get("id", "")
    activity_type = activity.get("type", "")

    for inbox in inboxes:
        delivery = OutboundDelivery.objects.create(
            activity_id=activity_id,
            activity_type=activity_type,
            payload=activity,
            recipient_inbox=inbox,
            signing_actor_uri=signing_actor_uri,
        )
        deliver_activity(str(delivery.id))
        logger.debug("Queued %s delivery %s -> %s", activity_type, delivery.id, inbox)


def _enqueue_broadcast(activity: dict, signing_actor_uri: str) -> None:
    """Deliver an activity to all allowed remote instances (item fan-out)."""
    inboxes = _collect_broadcast_inboxes()
    if not inboxes:
        logger.debug("No allowed remote inboxes -- skipping broadcast delivery")
        return
    _enqueue_to_inboxes(activity, signing_actor_uri, inboxes)


def _enqueue_to_actor(
    activity: dict,
    signing_actor_uri: str,
    recipient_actor_uri: str,
) -> None:
    """Deliver an activity point-to-point to a single remote actor."""
    inbox = _inbox_for_actor_uri(recipient_actor_uri)
    if not inbox:
        logger.debug(
            "No inbox found for remote actor %s -- cannot deliver %s",
            recipient_actor_uri,
            activity.get("type"),
        )
        return
    _enqueue_to_inboxes(activity, signing_actor_uri, [inbox])


# ---------------------------------------------------------------------------
# Item outbox helpers
# ---------------------------------------------------------------------------


def publish_item_create(item: Item) -> None:
    """Federate a newly created (or newly public-federated) item."""
    if not _federation_enabled():
        return
    if not getattr(item, "user", None):
        return

    try:
        activity = item_to_create_activity(item)
        base = _base_url()
        signing_uri = f"{base}/federation/users/{item.user.username}"
        _enqueue_broadcast(activity, signing_uri)

        ap_id = activity["object"]["id"]
        if item.ap_id != ap_id:
            type(item).objects.filter(pk=item.pk).update(ap_id=ap_id)
    except Exception:
        logger.exception("publish_item_create failed for item %s", item.pk)


def publish_item_update(item: Item) -> None:
    """Federate an update to an existing item."""
    if not _federation_enabled():
        return
    if not getattr(item, "user", None):
        return

    try:
        activity = item_to_update_activity(item)
        base = _base_url()
        signing_uri = f"{base}/federation/users/{item.user.username}"
        _enqueue_broadcast(activity, signing_uri)
    except Exception:
        logger.exception("publish_item_update failed for item %s", item.pk)


def publish_item_delete(item: Item) -> None:
    """Federate deletion of an item."""
    if not _federation_enabled():
        return

    try:
        activity = item_to_delete_activity(item)
        if getattr(item, "user", None):
            base = _base_url()
            signing_uri = f"{base}/federation/users/{item.user.username}"
        else:
            signing_uri = _instance_actor_uri()
        _enqueue_broadcast(activity, signing_uri)
    except Exception:
        logger.exception("publish_item_delete failed for item %s", item.pk)


# ---------------------------------------------------------------------------
# Booking outbox helpers
# ---------------------------------------------------------------------------


def _booking_involves_remote_actor(booking: Booking) -> bool:
    """Return True if this booking crosses instance boundaries."""
    return bool(booking.remote_booker_actor_id)


def _booking_signing_uri(booking: Booking, as_owner: bool = False) -> str:  # noqa: FBT001, FBT002
    """Return the signing actor URI for outbound booking activities."""
    base = _base_url()
    if as_owner:
        return f"{base}/federation/users/{booking.item.user.username}"
    if booking.user:
        return f"{base}/federation/users/{booking.user.username}"
    return _instance_actor_uri()


def publish_booking_offer(booking: Booking) -> None:
    """Send an ``Offer`` activity to the item owner when a new booking is created."""
    if not _federation_enabled():
        return
    # Only federate when the item owner is on a different instance
    # (i.e. item is a RemoteItem reference OR item.user != booking.user)
    if not booking.item.ap_id:
        return  # item is purely local -- no need to federate the booking

    try:
        activity = booking_to_offer_activity(booking)
        signing_uri = _booking_signing_uri(booking)
        # Deliver to item owner's inbox (cross-instance booking)
        item_owner_actor = (
            f"{_base_url()}/federation/users/{booking.item.user.username}"
        )
        inbox = _inbox_for_actor_uri(item_owner_actor)
        if inbox:
            _enqueue_to_inboxes(activity, signing_uri, [inbox])
        else:
            # Item owner is local — no delivery needed (handled locally)
            logger.debug(
                "publish_booking_offer: item owner is local, no delivery for %s",
                booking.pk,
            )
    except Exception:
        logger.exception("publish_booking_offer failed for booking %s", booking.pk)


def publish_booking_accept(booking: Booking) -> None:
    """Send ``Accept`` to the booker when a booking is confirmed."""
    if not _federation_enabled():
        return
    if not _booking_involves_remote_actor(booking):
        return

    try:
        activity = booking_to_accept_activity(booking)
        signing_uri = _booking_signing_uri(booking, as_owner=True)
        booker_uri = booking.remote_booker_actor.ap_id
        _enqueue_to_actor(activity, signing_uri, booker_uri)
    except Exception:
        logger.exception("publish_booking_accept failed for booking %s", booking.pk)


def publish_booking_reject(booking: Booking) -> None:
    """Send ``Reject`` to the booker when a booking is declined."""
    if not _federation_enabled():
        return
    if not _booking_involves_remote_actor(booking):
        return

    try:
        activity = booking_to_reject_activity(booking)
        signing_uri = _booking_signing_uri(booking, as_owner=True)
        booker_uri = booking.remote_booker_actor.ap_id
        _enqueue_to_actor(activity, signing_uri, booker_uri)
    except Exception:
        logger.exception("publish_booking_reject failed for booking %s", booking.pk)


def publish_booking_counter_offer(booking: Booking) -> None:
    """Send ``TentativeAccept`` (with counter-offer) to the booker."""
    if not _federation_enabled():
        return
    if not _booking_involves_remote_actor(booking):
        return

    try:
        activity = booking_to_tentative_accept_activity(booking)
        signing_uri = _booking_signing_uri(booking, as_owner=True)
        booker_uri = booking.remote_booker_actor.ap_id
        _enqueue_to_actor(activity, signing_uri, booker_uri)
    except Exception:
        logger.exception(
            "publish_booking_counter_offer failed for booking %s", booking.pk
        )


def publish_booking_cancel(booking: Booking, cancelled_by_uri: str) -> None:
    """Send ``Undo`` to the other party when a booking is cancelled."""
    if not _federation_enabled():
        return
    if not _booking_involves_remote_actor(booking):
        return

    try:
        activity = booking_to_cancel_activity(booking, cancelled_by_uri)
        # Determine the recipient: the party that did NOT cancel
        base = _base_url()
        owner_uri = f"{base}/federation/users/{booking.item.user.username}"
        booker_uri = booking.remote_booker_actor.ap_id

        if cancelled_by_uri == booker_uri:
            recipient_uri = owner_uri
            inbox = _inbox_for_actor_uri(recipient_uri)
        else:
            recipient_uri = booker_uri
            inbox = _inbox_for_actor_uri(recipient_uri)

        if inbox:
            _enqueue_to_inboxes(activity, cancelled_by_uri, [inbox])
    except Exception:
        logger.exception("publish_booking_cancel failed for booking %s", booking.pk)


# ---------------------------------------------------------------------------
# Message outbox helpers
# ---------------------------------------------------------------------------


def _message_involves_remote_actor(message: Message) -> bool:
    """Return True if either side of the booking thread is remote."""
    booking = message.booking
    return bool(booking.remote_booker_actor_id)


def publish_message(message: Message) -> None:
    """Send a ``Create Note`` activity to the other participant in the thread."""
    if not _federation_enabled():
        return
    if not _message_involves_remote_actor(message):
        return

    try:
        activity = message_to_create_activity(message)
        base = _base_url()
        booking = message.booking

        # Determine sender URI and recipient URI
        if message.sender:
            sender_uri = f"{base}/federation/users/{message.sender.username}"
        elif message.remote_sender_actor:
            sender_uri = message.remote_sender_actor.ap_id
        else:
            sender_uri = _instance_actor_uri()

        owner_uri = f"{base}/federation/users/{booking.item.user.username}"
        booker_uri = (
            booking.remote_booker_actor.ap_id
            if booking.remote_booker_actor
            else f"{base}/federation/users/{booking.user.username}"
        )

        # Deliver to the party that did not send
        recipient_uri = booker_uri if sender_uri == owner_uri else owner_uri
        inbox = _inbox_for_actor_uri(recipient_uri)
        if inbox:
            _enqueue_to_inboxes(activity, sender_uri, [inbox])
        else:
            logger.debug(
                "publish_message: recipient %s has no known inbox for message %s",
                recipient_uri,
                message.pk,
            )
    except Exception:
        logger.exception("publish_message failed for message %s", message.pk)


# ---------------------------------------------------------------------------
# User deletion (GDPR)
# ---------------------------------------------------------------------------


def publish_delete_person(username: str, actor_uri: str) -> None:
    """Broadcast a ``Delete Person`` activity when a local user is deleted.

    This is best-effort: if delivery fails the remote peer will eventually
    soft-delete the cached actor when they try to contact it.

    ``actor_uri`` must be the full AP actor URI (computed before the user row
    is gone from the DB).
    """
    if not _federation_enabled():
        return

    try:
        base = _base_url()
        activity = {
            "@context": "https://www.w3.org/ns/activitystreams",
            "id": f"{base}/federation/activities/delete-person-{username}",
            "type": "Delete",
            "actor": actor_uri,
            "to": ["https://www.w3.org/ns/activitystreams#Public"],
            "object": {
                "id": actor_uri,
                "type": "Person",
            },
        }
        _enqueue_broadcast(activity, actor_uri)
    except Exception:
        logger.exception("publish_delete_person failed for user %s", username)
