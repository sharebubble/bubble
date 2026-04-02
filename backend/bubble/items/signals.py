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

    Guarded by ``publish_notification_sent`` so the notification fires exactly
    once per item, even if the item is moved back to draft and re-published.
    """

    if instance.publish_notification_sent:
        return

    is_published = instance.status in ItemStatus.published()

    if not is_published:
        return

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

    # Mark as notified — skip the signal to avoid recursion.
    Item.objects.filter(pk=instance.pk).update(publish_notification_sent=True)
    instance.publish_notification_sent = True
