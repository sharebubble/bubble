import uuid

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils.translation import gettext_lazy as _

from bubble.items.models import Item
from config.settings.base import AUTH_USER_MODEL

MIN_RATING = 1
MAX_RATING = 5


class Comment(models.Model):
    """A comment a registered user leaves on an item.

    Users can ask questions or share their experience with an item and may
    optionally attach a star rating (1-5) describing how good the
    usage/experience of the item was.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    item = models.ForeignKey(
        Item,
        on_delete=models.CASCADE,
        related_name="comments",
    )
    user = models.ForeignKey(
        AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="comments",
    )
    body = models.TextField(
        help_text=_("The comment text, e.g. a question or shared experience."),
    )
    rating = models.PositiveSmallIntegerField(
        blank=True,
        null=True,
        validators=[MinValueValidator(MIN_RATING), MaxValueValidator(MAX_RATING)],
        help_text=_("Optional star rating from 1 to 5."),
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(rating__isnull=True)
                    | models.Q(rating__gte=MIN_RATING, rating__lte=MAX_RATING)
                ),
                name="comments_rating_between_1_and_5",
            ),
        ]

    def __str__(self):
        return f"Comment by {self.user} on {self.item_id}"
