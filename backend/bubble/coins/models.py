"""Community-coin valuations for zero-price transactions.

Plenty of what changes hands in a Bubble community is listed without a price:
items given away, lent out, or simply offered at ``0``. Money never moves for
those, but the exchange still has a value — so once such a transaction is
settled the booker is asked what it was worth to them in *community coins*
(the currency is named through ``COIN_NAME`` / ``COIN_SHORT_NAME``; one coin is
meant to be read as roughly one unit of ``DEFAULT_CURRENCY``).

The recorded valuations are public to everyone who can see the item and form
its track record: what was borrowed, bought or rented, by whom, and at which
coin value.
"""

import uuid
from decimal import ROUND_HALF_UP, Decimal

from django.core.validators import MinValueValidator
from django.db import models
from django.utils.translation import gettext_lazy as _

from bubble.bookings.models import Booking, BookingStatus
from bubble.items.models import Item, RentalPeriodType, SalesType
from config.settings.base import AUTH_USER_MODEL

# Listing types whose transactions can be valued in coins. "Wanted" listings
# are requests rather than offers, so nothing changes hands through them.
VALUABLE_SALES_TYPES = (
    SalesType.SELL,
    SalesType.RENT,
    SalesType.DONATE,
    SalesType.BORROW,
)

# Listing types billed per rental period — these are valued with a per-period
# rate (the slider adjusts the hourly/daily price) rather than a lump sum.
RENTAL_SALES_TYPES = (SalesType.RENT, SalesType.BORROW)

# A transaction only counts once the owner has agreed to it — from there on
# it is either under way (the item has been handed over) or done.
SETTLED_BOOKING_STATUSES = (
    BookingStatus.CONFIRMED,
    BookingStatus.IN_PROGRESS,
    BookingStatus.COMPLETED,
)

CENTS = Decimal("0.01")


def is_free_item(item: Item) -> bool:
    """Whether *item* is offered without a price (blank or exactly zero).

    A coin-*priced* item (``price_unit == COIN`` with a real amount) is not
    free — that price is a binding listing term, set by the owner, and is
    unrelated to this voluntary post-transaction valuation.
    """
    return item.price is None or item.price.amount == 0


def is_rental_item(item: Item) -> bool:
    """Whether *item* is billed per rental period rather than as a lump sum."""
    return item.sales_type in RENTAL_SALES_TYPES


def is_valuable_booking(booking: Booking) -> bool:
    """Whether *booking* may be valued in community coins.

    True for settled bookings made by a local user on a free item that is
    actually on offer (sell / rent / donate / borrow).
    """
    if booking.user_id is None or booking.status not in SETTLED_BOOKING_STATUSES:
        return False
    item = booking.item
    return item.sales_type in VALUABLE_SALES_TYPES and is_free_item(item)


def rental_total(booking: Booking, rate: Decimal) -> Decimal:
    """Convert a per-period coin *rate* into the total for *booking*.

    Falls back to the bare rate for bookings without a derivable duration
    (open-ended rentals), where a total cannot be computed.
    """
    periods = booking.duration_in_periods()
    if periods is None:
        return Decimal(rate).quantize(CENTS, rounding=ROUND_HALF_UP)
    return (Decimal(rate) * periods).quantize(CENTS, rounding=ROUND_HALF_UP)


class CoinValuationManager(models.Manager):
    def for_item(self, item) -> models.QuerySet:
        """Return the track record of a single item, newest first."""
        return self.filter(item=item).select_related("user", "booking")

    def last_for(self, *, user, item) -> "CoinValuation | None":
        """Return the valuation this user last recorded on this item.

        Used to pre-fill the slider with the price someone picked the last
        time they got this item, so repeat transactions need no re-thinking.
        Ordered by ``updated_at``: correcting an older entry is the most
        recent act of picking a value, so it is the one to offer again.
        """
        if not user or not user.is_authenticated:
            return None
        return self.filter(user=user, item=item).order_by("-updated_at").first()


class CoinValuation(models.Model):
    """What one settled transaction was worth to its booker, in coins."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking = models.OneToOneField(
        Booking,
        on_delete=models.CASCADE,
        related_name="coin_valuation",
        verbose_name=_("Booking"),
        help_text=_("The settled transaction this valuation belongs to."),
    )
    # Denormalised from the booking so an item's track record is a single
    # indexed lookup, and so valuations stay attributable after the booking
    # is re-pointed or the item's price changes.
    item = models.ForeignKey(
        Item,
        on_delete=models.CASCADE,
        related_name="coin_valuations",
        verbose_name=_("Item"),
    )
    user = models.ForeignKey(
        AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="coin_valuations",
        verbose_name=_("User"),
        help_text=_("The person who received the item and set this value."),
    )
    amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0"))],
        verbose_name=_("Amount"),
        help_text=_("Total value of the transaction in community coins."),
    )
    rate = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        blank=True,
        null=True,
        validators=[MinValueValidator(Decimal("0"))],
        verbose_name=_("Rate"),
        help_text=_(
            "Value per rental period in community coins. Set for rentals only; "
            "``amount`` holds the resulting total for the booked duration."
        ),
    )
    rental_period = models.CharField(
        max_length=1,
        blank=True,
        choices=RentalPeriodType,
        verbose_name=_("Rental period"),
        help_text=_("Period the rate applies to, as it stood at valuation time."),
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = CoinValuationManager()

    class Meta:
        ordering = ["-created_at"]
        verbose_name = _("Coin valuation")
        verbose_name_plural = _("Coin valuations")
        indexes = [
            # Serves the per-item track record, which is read newest-first.
            models.Index(fields=["item", "-created_at"], name="coins_item_created_idx"),
            # Serves the "what did I pick last time?" suggestion lookup.
            models.Index(fields=["user", "item"], name="coins_user_item_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount__gte=0),
                name="coin_valuation_amount_not_negative",
            ),
            models.CheckConstraint(
                condition=models.Q(rate__isnull=True) | models.Q(rate__gte=0),
                name="coin_valuation_rate_not_negative",
            ),
        ]

    def __str__(self):
        return f"{self.amount} coins for {self.item.name} by {self.user}"
