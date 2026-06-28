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

from bubble.items.models import Item, RentalPeriodType, money_defaults
from config.settings.base import AUTH_USER_MODEL


class BookingStatus(models.IntegerChoices):
    PENDING = 1, _("Pending")
    CANCELLED = 2, _("Cancelled")
    CONFIRMED = 3, _("Confirmed")
    COMPLETED = 4, _("Completed")
    REJECTED = 5, _("Rejected")
    IN_PROGRESS = 6, _("In Progress")


class BookingManager(models.Manager):
    def get_for_user(self, user):
        items_with_change_permission = get_objects_for_user(
            user,
            "items.change_item",
            klass=Item,
            accept_global_perms=False,
        )

        # Include bookings where the local user is the booker OR where
        # the user owns the item (covers both local and remote bookers).
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
        null=True,
        blank=True,
        help_text=_(
            "Local user who made this booking. Null when booker is a remote actor."
        ),
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

    # Fulfillment tracking: timestamps for the physical exchange of the item.
    handover_confirmed_at = models.DateTimeField(
        blank=True,
        null=True,
        help_text=_(
            "When the booker confirmed they received the item. For sales this "
            "triggers the ownership transfer; for rentals it starts the rental."
        ),
    )
    return_confirmed_at = models.DateTimeField(
        blank=True,
        null=True,
        help_text=_(
            "When the owner confirmed the rented item was returned, completing "
            "the rental."
        ),
    )

    # Federation: remote booker (XOR with user — enforced by DB constraint below)
    remote_booker_actor = models.ForeignKey(
        "federation.RemoteActor",
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="bookings",
        help_text=_("Set when the booker is a remote federated actor."),
    )
    # Cached ActivityPub object URI
    ap_id = models.URLField(
        max_length=2048,
        blank=True,
        default="",
        editable=False,
        help_text=_("ActivityPub object URI for this booking."),
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    history = HistoricalRecords()

    objects = BookingManager()

    class Meta:
        indexes = [
            models.Index(fields=["user", "status"]),
            models.Index(fields=["item", "status"]),
        ]
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
                condition=Q(
                    status__in=[BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS]
                )
                & Q(time_to__isnull=False),
                index_type="gist",
            ),
            ExclusionConstraint(
                name="exclude_overlapping_confirmed_bookings_without_time_to",
                expressions=[(F("item"), "=")],
                condition=Q(
                    status__in=[BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS]
                )
                & Q(time_to__isnull=True),
                index_type="gist",
            ),
            # Enforce XOR: a booking must have exactly one of
            # user OR remote_booker_actor
            models.CheckConstraint(
                condition=(
                    models.Q(user__isnull=False, remote_booker_actor__isnull=True)
                    | models.Q(user__isnull=True, remote_booker_actor__isnull=False)
                ),
                name="booking_booker_xor",
            ),
        ]

    def __str__(self):
        booker = self.user or self.remote_booker_actor or "unknown"
        return f"Booking for {self.item.name} by {booker}"

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

        The stored item price is the price for one rental period (hour, day,
        or week, as set by ``item.rental_period``). The hourly rate is derived
        from that period before multiplying by the booked duration in hours.
        """
        if self.item.sales_type != "rent" or not self.item.price:
            return None
        if not self.time_from or not self.time_to:
            return None

        period_hours = {
            RentalPeriodType.HOURLY: decimal.Decimal("1"),
            RentalPeriodType.DAILY: decimal.Decimal("24"),
            RentalPeriodType.WEEKLY: decimal.Decimal("168"),
        }
        hours_per_period = period_hours.get(
            self.item.rental_period, decimal.Decimal("1")
        )

        duration = self.time_to - self.time_from
        total_seconds = decimal.Decimal(str(duration.total_seconds()))
        hours = total_seconds / decimal.Decimal("3600")
        price = self.item.price * hours / hours_per_period
        # Quantize to 2 decimal places (matches the model's decimal_places=2
        # and avoids float-precision artefacts from total_seconds()).
        return Money(price.amount.quantize(decimal.Decimal("0.01")), price.currency)


class Message(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking = models.ForeignKey(
        Booking, on_delete=models.CASCADE, related_name="messages"
    )
    sender = models.ForeignKey(
        AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sent_messages",
        null=True,
        blank=True,
        help_text=_("Local sender. Null when sender is a remote actor."),
    )
    # Federation: remote sender (XOR with sender)
    remote_sender_actor = models.ForeignKey(
        "federation.RemoteActor",
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="sent_messages",
        help_text=_("Set when the message sender is a remote federated actor."),
    )
    ap_id = models.URLField(
        max_length=2048,
        blank=True,
        default="",
        editable=False,
        help_text=_("ActivityPub object URI for this message."),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    message = models.TextField()
    is_read = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["booking", "is_read"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(sender__isnull=False, remote_sender_actor__isnull=True)
                    | models.Q(sender__isnull=True, remote_sender_actor__isnull=False)
                ),
                name="message_sender_xor",
            ),
        ]

    def __str__(self):
        s = self.sender or self.remote_sender_actor or "unknown"
        return f"Message from {s}"
