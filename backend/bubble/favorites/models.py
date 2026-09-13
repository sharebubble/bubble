import uuid

from django.db import models
from django.utils.translation import gettext_lazy as _

from bubble.items.models import Item
from config.settings.base import AUTH_USER_MODEL


class Favorite(models.Model):
    user = models.ForeignKey(
        AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="favorites",
    )
    title = models.CharField(max_length=255)
    url = models.URLField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "url")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.username} - {self.title}"

    @classmethod
    def get_user_favorites(cls, user):
        return cls.objects.filter(user=user)


class FavoriteItemManager(models.Manager):
    def for_user(self, user) -> models.QuerySet:
        """Return a user's favorites, newest first, on items they can still see.

        An item can become invisible after it was favorited (its visibility is
        narrowed, or it leaves the published statuses), and such a favorite must
        not leak the item back through the favorites list — so the queryset is
        intersected with what the item visibility rules currently allow.
        """
        if not user or not user.is_authenticated:
            return self.none()
        return self.filter(
            user=user,
            item__in=Item.objects.visible_to(user),
        )


class FavoriteItem(models.Model):
    """A user's bookmark on an :class:`~bubble.items.models.Item`.

    Distinct from :class:`Favorite`, which bookmarks an arbitrary URL. This one
    points at a catalogue item and drives the heart on the item detail page, the
    favorites row on the start page and the favorites overview.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="favorite_items",
    )
    item = models.ForeignKey(
        Item,
        on_delete=models.CASCADE,
        related_name="favorited_by",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    objects = FavoriteItemManager()

    class Meta:
        verbose_name = _("Favorite item")
        verbose_name_plural = _("Favorite items")
        # Newest mark first — the start page shows the most recently marked.
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "item"],
                name="favorites_unique_user_item",
            ),
        ]
        indexes = [
            # Serves the per-user list, which always orders by -created_at.
            models.Index(
                fields=["user", "-created_at"],
                name="favorites_user_created_idx",
            ),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.item.name}"
