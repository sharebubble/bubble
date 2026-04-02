import logging

from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils.translation import gettext as _
from guardian.shortcuts import get_users_with_perms

from bubble.core.websocket_signals import send_message_notification
from bubble.items.models import Item, ItemStatus, SalesType
from bubble.notifications.dispatch import dispatch_notification

from .models import Booking, BookingStatus, Message

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

    notification_context = {
        "message": instance.message,
        "item_title": item.name,
        "sender": instance.sender.name,
    }

    if instance.booking.user != instance.sender:
        send_message_notification(
            instance.booking.user_id,  # type: ignore[union-attr]
            message=instance.message,
            booking_uuid=str(instance.booking.id),
        )
        logger.info(
            "Sent new message notification to user %s for message %s",
            instance.booking.user.username,
            instance.pk,
        )
        dispatch_notification(
            instance.booking.user_id, "new_message", notification_context
        )
    else:
        # Send notification to each user with change permission (except the sender)
        for user in users_with_perms:
            if user.id != instance.sender_id:  # type: ignore[union-attr]
                send_message_notification(
                    user.id,  # type: ignore[union-attr]
                    message=instance.message,
                    booking_uuid=str(instance.booking.id),
                )
                logger.info(
                    "Sent new message notification to user %s for message %s",
                    getattr(user, "username", str(user)),
                    instance.pk,
                )
                dispatch_notification(user, "new_message", notification_context)


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

    # Send notification to each user with change permission (except the booking creator)
    for user in users_with_perms:
        if user.id != instance.user_id:  # type: ignore[union-attr]
            send_message_notification(
                user.id,  # type: ignore[union-attr]
                message=_("A new booking has been created for your item."),
            )
            logger.info(
                "Sent new booking notification to user %s for booking %s",
                getattr(user, "username", str(user)),
                instance.pk,
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
