import logging
from typing import TYPE_CHECKING, cast

from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils.translation import gettext as _
from guardian.shortcuts import get_users_with_perms

from bubble.core.websocket_signals import send_message_notification
from bubble.items.models import Item, ItemStatus, SalesType
from bubble.notifications.dispatch import dispatch_notification
from bubble.notifications.models import EventType

from .models import Booking, BookingStatus, Message

if TYPE_CHECKING:
    from bubble.users.models import User

logger = logging.getLogger(__name__)


@receiver(post_save, sender=Message)
def notify_new_message(sender, instance: Message, created, **kwargs):
    """Notify item owners when a new message is created."""
    if not created:
        return

    # Get the item from the booking
    item = instance.booking.item

    # Get all users with change permission on this item
    users_with_perms = get_users_with_perms(
        item, only_with_perms_in=["change_item"], with_group_users=False
    )

    # sender may be None for remote actors; fall back gracefully
    local_sender = instance.sender
    remote_sender = instance.remote_sender_actor
    sender_display = (
        local_sender.name
        if local_sender
        else (str(remote_sender) if remote_sender else _("Remote user"))
    )
    notification_context = {
        "message": instance.message,
        "item_title": item.name,
        "sender": sender_display,
    }

    # local_booker may be None if booking was made by a remote actor
    local_booker = instance.booking.user

    # Determine if the sender is the booker side or the owner side.
    # For remote senders, treat them as the booker side.
    sender_is_booker = (local_sender is not None and local_sender == local_booker) or (
        local_sender is None and remote_sender is not None
    )

    if not sender_is_booker:
        # Message from item owner → notify the booker (if local)
        if local_booker is not None:
            send_message_notification(
                local_booker.id,
                message=instance.message,
                booking_uuid=str(instance.booking.id),
            )
            logger.info(
                "Sent new message notification to user %s for message %s",
                local_booker.username,
                instance.pk,
            )
            dispatch_notification(
                local_booker, EventType.NEW_MESSAGE, notification_context
            )
    else:
        # Message from booker → notify each user with change permission
        for user in users_with_perms:
            user_obj = cast("User", user)
            # Skip the sender if they somehow also have change_item perm
            if local_sender is not None and user_obj.id == local_sender.id:
                continue
            send_message_notification(
                user_obj.id,
                message=instance.message,
                booking_uuid=str(instance.booking.id),
            )
            logger.info(
                "Sent new message notification to user %s for message %s",
                user_obj.username,
                instance.pk,
            )
            dispatch_notification(user_obj, EventType.NEW_MESSAGE, notification_context)


@receiver(post_save, sender=Booking)
def notify_new_booking(sender, instance: Booking, created, **kwargs):
    """Notify item owners when a new booking is created."""
    if not created:
        return

    # Get the item
    item = instance.item

    # Get all users with change permission on this item
    users_with_perms = get_users_with_perms(
        item, only_with_perms_in=["change_item"], with_group_users=False
    )

    notification_context = {"item_title": item.name}

    # Send notification to each user with change permission (except the booking creator)
    local_booker_id = instance.user_id  # may be None for remote bookers
    for user in users_with_perms:
        if user.id != local_booker_id:
            send_message_notification(
                user.id,
                message=_("A new booking has been created for your item."),
            )
            logger.info(
                "Sent new booking notification to user %s for booking %s",
                getattr(user, "username", str(user)),
                instance.pk,
            )
            dispatch_notification(
                cast("User", user), EventType.NEW_BOOKING, notification_context
            )


@receiver(post_save, sender=Booking)
def update_item_status(sender, instance: Booking, created, **kwargs):
    """Notify item owners when a new booking is created."""
    # Get the item
    item: Item = instance.item

    # Booking confirmed, then send the item status to sold
    if instance.status == BookingStatus.CONFIRMED:
        if item.sales_type in (SalesType.SELL, SalesType.DONATE, SalesType.WANT_BUY):
            item.status = ItemStatus.SOLD
        elif (
            item.sales_type in (SalesType.RENT, SalesType.BORROW, SalesType.WANT_RENT)
            and instance.is_active
        ):
            item.status = ItemStatus.RENTED
        item.save(update_fields=["status"])

    # Booking cancelled or rejected, and item is sold or rented, set available
    elif instance.status in [
        BookingStatus.CANCELLED,
        BookingStatus.REJECTED,
    ] and item.status in [
        ItemStatus.SOLD,
        ItemStatus.RENTED,
    ]:
        # If booking is cancelled or rejected, and item is sold or rented, set available
        item.status = ItemStatus.AVAILABLE
        item.save(update_fields=["status"])
