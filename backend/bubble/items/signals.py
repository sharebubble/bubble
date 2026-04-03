from __future__ import annotations

import logging

from django.db.models.signals import post_save
from django.dispatch import receiver

from bubble.notifications.dispatch import dispatch_channel_notification

from .models import Item, ItemStatus

logger = logging.getLogger(__name__)


@receiver(post_save, sender=Item)
def notify_new_item(sender, instance: Item, **kwargs) -> None:
    """Dispatch a channel notification the first time an item becomes published.

    Uses an atomic compare-and-set on ``publish_notification_sent`` so that only
    one concurrent signal handler can enqueue the notification.
    """

    is_published = instance.status in ItemStatus.published()
    if not is_published:
        return

    # Atomic guard: only one process/thread can flip False -> True.
    updated = Item.objects.filter(
        pk=instance.pk,
        publish_notification_sent=False,
    ).update(publish_notification_sent=True)

    if updated == 0:
        # Already notified (or item no longer exists).
        instance.publish_notification_sent = True
        return

    instance.publish_notification_sent = True

    first_image = instance.get_first_image()
    image_url = ""
    if first_image and first_image.original:
        image_url = first_image.original.url

    context = {
        "item_id": str(instance.pk),
        "name": instance.name,
        "description": instance.description,
        "sales_type": instance.sales_type,
        "image_url": image_url,
    }

    logger.info(
        "Dispatching new_item channel notification for item %s (status %s)",
        instance.pk,
        instance.status,
    )
    dispatch_channel_notification("new_item", context)
