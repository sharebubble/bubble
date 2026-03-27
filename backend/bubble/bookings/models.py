import decimal
import uuid

from django.conf import settings
from django.contrib.postgres.constraints import ExclusionConstraint
from django.db import models
from django.db.models import F, Func, Q
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from djmoney.models.fields import MoneyField
from guardian.shortcuts import get_objects_for_user
from moneyed.classes import Money
from simple_history.models import HistoricalRecords

from bubble.items.models import Item, money_defaults
from config.settings.base import AUTH_USER_MODEL


class BookingStatus(models.IntegerChoices):
    PENDING = 1, _("Pending")
    CANCELLED = 2, _("Cancelled")
    CONFIRMED = 3, _("Confirmed")
    COMPLETED = 4, _("Completed")
    REJECTED = 5, _("Rejected")


class BookingManager(models.Manager):
    def get_for_user(self, user):
        items_with_change_permission = get_objects_for_user(
            user,
            "items.change_item",
            klass=Item,
            accept_global_perms=False,
        )

        return self.filter(user=user) | self.filter(
            item__in=items_with_change_permission
        )


class Booking(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    status = models.IntegerField(
        choices=BookingStatus, default=BookingStatus.PENDING, verbose_name=_("Status")
    )
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="bookings")
    user = models.ForeignKey(
        AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="bookings",
    )

    time_from = models.DateTimeField(
        blank=True, null=True, default=timezone.now, verbose_name=_("Time From")
    )
    time_to = models.DateTimeField(blank=True, null=True, verbose_name=_("Time To"))

    offer = MoneyField(
        **money_defaults,
        blank=True,
        null=True,
        default_currency=settings.DEFAULT_CURRENCY,
        verbose_name=_("Offer"),
        help_text=_("Offered price for the booking"),
    )
    counter_offer = MoneyField(
        **money_defaults,
        blank=True,
        null=True,
        default_currency=settings.DEFAULT_CURRENCY,
        verbose_name=_("Counter Offer"),
        help_text=_("Counter offer price for the booking"),
    )

    accepted_by = models.ForeignKey(
        AUTH_USER_MODEL,
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="accepted_bookings",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    history = HistoricalRecords()

    objects = BookingManager()

    class Meta:
        # Prevent overlapping confirmed bookings for the same item.
        # Uses PostgreSQL exclusion constraint on the tstzrange(time_from, time_to)
        # and item equality. Only applies when status is CONFIRMED.
        constraints = [
            ExclusionConstraint(
                name="exclude_overlapping_confirmed_bookings_with_time_to",
                expressions=[
                    (Func(F("time_from"), F("time_to"), function="tstzrange"), "&&"),
                    (F("item"), "="),
                ],
                condition=Q(status=BookingStatus.CONFIRMED) & Q(time_to__isnull=False),
                index_type="gist",
            ),
            ExclusionConstraint(
                name="exclude_overlapping_confirmed_bookings_without_time_to",
                expressions=[(F("item"), "=")],
                condition=Q(status=BookingStatus.CONFIRMED) & Q(time_to__isnull=True),
                index_type="gist",
            ),
        ]

    def __str__(self):
        return f"Booking for {self.item.name} by {self.user}"

    @property
    def is_active(self):
        """Check if the booking is currently active."""
        now = timezone.now()
        return self.status == BookingStatus.CONFIRMED and self.time_from <= now <= (
            self.time_to or now
        )

    @property
    def rental_price(self) -> Money | None:
        """
        Calculate the price for this booking if the item is a rental.
        Returns None if not a rental or if required fields are missing.
        """
        if self.item.sales_type != "rent" or not self.item.price:
            return None
        if not self.time_from or not self.time_to:
            return None

        duration = self.time_to - self.time_from
        total_seconds = decimal.Decimal(str(duration.total_seconds()))
        hours = total_seconds / decimal.Decimal("3600")
        return self.item.price * hours


class Message(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking = models.ForeignKey(
        Booking, on_delete=models.CASCADE, related_name="messages"
    )
    sender = models.ForeignKey(
        AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sent_messages",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    message = models.TextField()
    is_read = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Message from {self.sender}"
