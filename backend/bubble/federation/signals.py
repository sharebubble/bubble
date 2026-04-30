"""Federation signals.

- Auto-generate a LocalActorKey for new users when federation is enabled.
- Propagate Create/Update/Delete activities when items change.
- Propagate Delete Person when a local user is deleted (GDPR).
- Propagate Delete for all federated items when a user disables federation.
"""

import logging

from django.conf import settings
from django.db.models.signals import post_delete, post_save, pre_delete, pre_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)

# Track previous federation_visibility before save to detect transitions.
_PREV_VISIBILITY: dict = {}  # keyed by str(item pk)

# Cache actor URIs before user rows are deleted so post_delete can use them.
_PENDING_DELETE_ACTOR_URIS: dict = {}  # keyed by str(user pk)

# Track previous federation_enabled value on User before save.
_PREV_FEDERATION_ENABLED: dict = {}  # keyed by str(user pk)


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_actor_key_for_new_user(sender, instance, created, **kwargs):
    """Lazily generate an RSA keypair for newly created users.

    Only runs when ``FEDERATION_ENABLED=True`` and when
    ``FEDERATION_KEY_ENCRYPTION_KEY`` is configured. Skips silently if the
    encryption key is missing (e.g. in tests or non-federated deployments).
    """
    if not created:
        return
    if not getattr(settings, "FEDERATION_ENABLED", False):
        return
    if not getattr(settings, "FEDERATION_KEY_ENCRYPTION_KEY", ""):
        return

    try:
        from bubble.federation.crypto import generate_and_store_keypair  # noqa: PLC0415
        from bubble.federation.models import LocalActorKey  # noqa: PLC0415

        if not LocalActorKey.objects.filter(user=instance).exists():
            generate_and_store_keypair(LocalActorKey, user=instance)
            logger.debug("Generated AP keypair for user %s", instance.username)
    except Exception:
        # Never crash user creation due to federation setup
        logger.exception("Failed to generate AP keypair for user %s", instance)


# ---------------------------------------------------------------------------
# User federation opt-out cascade
# ---------------------------------------------------------------------------


@receiver(pre_save, sender=settings.AUTH_USER_MODEL)
def _user_pre_save(sender, instance, **kwargs):
    """Snapshot federation_enabled before save so post_save can diff."""
    if instance.pk:
        try:
            prev = sender.objects.only("federation_enabled").get(pk=instance.pk)
            _PREV_FEDERATION_ENABLED[str(instance.pk)] = getattr(
                prev, "federation_enabled", True
            )
        except sender.DoesNotExist:
            pass


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def _user_post_save(sender, instance, created, **kwargs):
    """When federation_enabled flips False, send Delete for all their items."""
    if created:
        _PREV_FEDERATION_ENABLED.pop(str(instance.pk), None)
        return

    prev_enabled = _PREV_FEDERATION_ENABLED.pop(str(instance.pk), None)
    if prev_enabled is None:
        return

    now_enabled = getattr(instance, "federation_enabled", True)
    if prev_enabled and not now_enabled:
        # User turned federation off — delete all their previously-federated items
        _cascade_delete_federated_items(instance)


def _cascade_delete_federated_items(user) -> None:
    """Broadcast Delete activities for all public_federated items owned by *user*."""
    from bubble.federation.outbox import publish_item_delete  # noqa: PLC0415
    from bubble.items.models import Item  # noqa: PLC0415

    items = Item.objects.filter(user=user, federation_visibility="public_federated")
    for item in items:
        try:
            publish_item_delete(item)
            # Flip item back to local_only without re-triggering signals
            Item.objects.filter(pk=item.pk).update(federation_visibility="local_only")
        except Exception:
            logger.exception(
                "_cascade_delete_federated_items: failed for item %s", item.pk
            )


# ---------------------------------------------------------------------------
# Item federation signals
# ---------------------------------------------------------------------------


def _item_should_federate(item) -> bool:
    """Return True if the item is eligible for outbound federation."""
    return (
        getattr(settings, "FEDERATION_ENABLED", False)
        and getattr(item, "federation_visibility", "") == "public_federated"
        and getattr(item, "user", None) is not None  # skip remote-authored items
        and getattr(item.user, "federation_enabled", True)
    )


@receiver(pre_save, sender="items.Item")
def _item_pre_save(sender, instance, **kwargs):
    """Snapshot federation_visibility before the save so post_save can diff."""
    if instance.pk:
        try:
            prev = sender.objects.only("federation_visibility").get(pk=instance.pk)
            _PREV_VISIBILITY[str(instance.pk)] = prev.federation_visibility
        except sender.DoesNotExist:
            pass


@receiver(post_save, sender="items.Item")
def federate_item_on_save(sender, instance, created, **kwargs):
    """Publish Create or Update activities when an item changes."""
    from bubble.federation.outbox import (  # noqa: PLC0415
        publish_item_create,
        publish_item_delete,
        publish_item_update,
    )

    is_federated = _item_should_federate(instance)
    prev_visibility = _PREV_VISIBILITY.pop(str(instance.pk), None)

    if created:
        if is_federated:
            publish_item_create(instance)
        return

    # Transition: local_only -> public_federated  ->  treat as Create
    if (
        prev_visibility == "local_only"
        and instance.federation_visibility == "public_federated"
        and is_federated
    ):
        publish_item_create(instance)
        return

    # Transition: public_federated -> local_only  ->  treat as Delete
    if (
        prev_visibility == "public_federated"
        and instance.federation_visibility == "local_only"
    ):
        publish_item_delete(instance)
        return

    if is_federated:
        publish_item_update(instance)


@receiver(post_delete, sender="items.Item")
def federate_item_on_delete(sender, instance, **kwargs):
    """Publish a Delete activity when a federated item is removed."""
    from bubble.federation.outbox import publish_item_delete  # noqa: PLC0415

    _PREV_VISIBILITY.pop(str(instance.pk), None)
    if _item_should_federate(instance) or getattr(instance, "ap_id", ""):
        publish_item_delete(instance)


# ---------------------------------------------------------------------------
# Booking federation signals
# ---------------------------------------------------------------------------

# Track previous booking status for transition detection.
_PREV_BOOKING_STATUS: dict = {}  # keyed by str(booking pk)


@receiver(pre_save, sender="bookings.Booking")
def _booking_pre_save(sender, instance, **kwargs):
    """Snapshot booking status before save so post_save can detect transitions."""
    if instance.pk:
        try:
            prev = sender.objects.only("status").get(pk=instance.pk)
            _PREV_BOOKING_STATUS[str(instance.pk)] = prev.status
        except sender.DoesNotExist:
            pass


@receiver(post_save, sender="bookings.Booking")
def federate_booking_on_save(sender, instance, created, **kwargs):
    """Publish booking activities when status changes."""
    # Skip signal when the save was triggered by an inbound federation handler
    if getattr(instance, "_skip_federation_signal", False):
        return
    from bubble.bookings.models import BookingStatus  # noqa: PLC0415
    from bubble.federation.outbox import (  # noqa: PLC0415
        publish_booking_accept,
        publish_booking_cancel,
        publish_booking_counter_offer,
        publish_booking_offer,
        publish_booking_reject,
    )

    prev_status = _PREV_BOOKING_STATUS.pop(str(instance.pk), None)

    if created:
        publish_booking_offer(instance)
        return

    new_status = instance.status

    if prev_status == new_status:
        return

    if new_status == BookingStatus.CONFIRMED:
        publish_booking_accept(instance)
    elif new_status == BookingStatus.REJECTED:
        publish_booking_reject(instance)
    elif new_status == BookingStatus.CANCELLED:
        # Determine who cancelled: if counter_offer was set, treat as
        # owner-side cancel; otherwise use booker.
        base_url = getattr(settings, "FEDERATION_BASE_URL", "")
        if not base_url:
            from bubble.federation.serializers import _base_url  # noqa: PLC0415

            base_url = _base_url()
        if instance.user:
            cancelled_by_uri = f"{base_url}/federation/users/{instance.user.username}"
        elif instance.remote_booker_actor:
            cancelled_by_uri = instance.remote_booker_actor.ap_id
        else:
            cancelled_by_uri = f"{base_url}/federation/instance-actor"
        publish_booking_cancel(instance, cancelled_by_uri)
    elif new_status == BookingStatus.PENDING and instance.counter_offer:
        # Counter-offer was set while keeping status PENDING
        publish_booking_counter_offer(instance)


# ---------------------------------------------------------------------------
# Message federation signals
# ---------------------------------------------------------------------------


@receiver(post_save, sender="bookings.Message")
def federate_message_on_save(sender, instance, created, **kwargs):
    """Publish a Create Note activity when a new booking message is sent."""
    if not created:
        return
    if getattr(instance, "_skip_federation_signal", False):
        return
    from bubble.federation.outbox import publish_message  # noqa: PLC0415

    publish_message(instance)


# ---------------------------------------------------------------------------
# User deletion (GDPR) — fan-out Delete Person to all allowed instances
# ---------------------------------------------------------------------------


@receiver(pre_delete, sender=settings.AUTH_USER_MODEL)
def _capture_actor_uri_before_user_delete(sender, instance, **kwargs):
    """Cache the AP actor URI while the user row still exists."""
    if not getattr(settings, "FEDERATION_ENABLED", False):
        return
    if not getattr(instance, "federation_enabled", True):
        return

    try:
        from bubble.federation.serializers import _base_url  # noqa: PLC0415

        base = _base_url()
        _PENDING_DELETE_ACTOR_URIS[str(instance.pk)] = (
            f"{base}/federation/users/{instance.username}"
        )
    except Exception:
        logger.exception(
            "Failed to capture actor URI for user %s before deletion", instance.pk
        )


@receiver(post_delete, sender=settings.AUTH_USER_MODEL)
def federate_user_delete(sender, instance, **kwargs):
    """Broadcast Delete Person after a local user has been removed."""
    actor_uri = _PENDING_DELETE_ACTOR_URIS.pop(str(instance.pk), None)
    if not actor_uri:
        return

    from bubble.federation.outbox import publish_delete_person  # noqa: PLC0415

    publish_delete_person(instance.username, actor_uri)
