from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from bubble.bookings.models import Booking, BookingStatus, Message
from bubble.coins.api.serializers import CoinValuationSerializer
from bubble.coins.models import is_valuable_booking
from bubble.items.api.serializers import ItemMinimalSerializer
from bubble.items.models import Item, SalesType
from bubble.users.api.serializers import UserSerializer


class RemoteActorMinimalSerializer(serializers.Serializer):
    """Read-only minimal representation of a federated RemoteActor."""

    ap_id = serializers.URLField(read_only=True)
    username = serializers.CharField(read_only=True)
    display_name = serializers.CharField(read_only=True)


class BookingSerializer(serializers.ModelSerializer):
    """Detailed serializer for Booking where `item` is represented only by UUID."""

    item = serializers.PrimaryKeyRelatedField(queryset=Item.objects.published())
    item_details = ItemMinimalSerializer(read_only=True, source="item")
    user = UserSerializer(read_only=True)
    remote_booker_actor = RemoteActorMinimalSerializer(read_only=True)
    unread_messages_count = serializers.SerializerMethodField()
    coin_valuation = serializers.SerializerMethodField()
    coin_valuation_eligible = serializers.SerializerMethodField()

    class Meta:
        model = Booking
        fields = [
            "id",
            "status",
            "item",
            "item_details",
            "user",
            "remote_booker_actor",
            "time_from",
            "time_to",
            "offer",
            "counter_offer",
            "accepted_by",
            "created_at",
            "updated_at",
            "unread_messages_count",
            "coin_valuation",
            "coin_valuation_eligible",
        ]
        read_only_fields = [
            "id",
            "user",
            "remote_booker_actor",
            "created_at",
            "updated_at",
        ]

    def get_unread_messages_count(self, obj) -> int | None:
        """Return unread_messages_count if it exists as an annotated field."""
        return getattr(obj, "unread_messages_count", None)

    @extend_schema_field(CoinValuationSerializer(allow_null=True))
    def get_coin_valuation(self, obj):
        """Return the community-coin value recorded for this booking, if any."""
        # The reverse one-to-one raises (an AttributeError subclass) when no
        # valuation exists, so ``getattr`` with a default covers both cases.
        valuation = getattr(obj, "coin_valuation", None)
        if valuation is None:
            return None
        return CoinValuationSerializer(valuation, context=self.context).data

    def get_coin_valuation_eligible(self, obj) -> bool:
        """Whether this transaction can be valued in community coins.

        Drives the prompt shown once a free (zero-price) transaction is
        settled, asking the booker what it was worth to them.
        """
        return is_valuable_booking(obj)

    def validate(self, attrs):
        """
        Validate that if time_to is not set, the item must allow open-ended rentals.
        """
        # On PATCH requests the item field may be absent from attrs; fall back to
        # the existing instance's item so the check still applies.
        time_to = (
            attrs.get("time_to")
            if "time_to" in attrs
            else getattr(self.instance, "time_to", None)
        )
        item = attrs.get("item") or getattr(self.instance, "item", None)

        # If time_to is not provided and we're creating/updating
        # Allow missing time_to for items that are sale-only. Sale-type items
        # (sell, donate, want_buy) don't need an end time, so treat them as exempt.
        is_sale_item = item and item.sales_type in (
            SalesType.SELL,
            SalesType.DONATE,
            SalesType.WANT_BUY,
        )

        if time_to is None and item and not item.rental_open_end and not is_sale_item:
            raise serializers.ValidationError(
                {
                    "time_to": (
                        "End time is required for this item. "
                        "The item does not allow open-ended rentals."
                    )
                }
            )

        # check that no pending booking request for the same item and user exists
        user = self.context["request"].user
        if (
            not self.instance
            and Booking.objects.filter(
                item=item, user=user, status=BookingStatus.PENDING
            ).exists()
        ):
            raise serializers.ValidationError(
                _("You already have a pending booking request for this item.")
            )

        # validate offer and counter_offer logic
        offer = attrs.get("offer", None)
        booking_status = attrs.get("status", None) or getattr(
            self.instance, "status", None
        )
        if (
            self.instance
            and offer is not None
            and booking_status != BookingStatus.PENDING
        ):
            raise serializers.ValidationError(
                {"offer": _("Offer can only be set for pending bookings.")}
            )
        counter_offer = attrs.get("counter_offer", None)
        if (
            self.instance
            and counter_offer is not None
            and booking_status != BookingStatus.PENDING
        ):
            raise serializers.ValidationError(
                {
                    "counter_offer": _(
                        "Counter-offer can only be set for pending bookings."
                    )
                }
            )

        return super().validate(attrs)

    def validate_status(self, value):
        """Ensure that status is a valid BookingStatus.

        The fulfillment transitions (IN_PROGRESS handover and COMPLETED via the
        ownership transfer / return) must go through the dedicated
        ``confirm_received`` / ``confirm_returned`` actions, so they cannot be set
        through a plain status PATCH. The booker may only cancel or revert to
        pending; completing a rental is reserved for the item owner.
        """
        if self.instance and value == BookingStatus.IN_PROGRESS:
            msg = _("Use the confirm-received action to start a rental.")
            raise serializers.ValidationError(msg)

        # A confirmed/in-progress booking whose rental period has already ended
        # actually happened - cancelling it after the fact wouldn't undo
        # anything and would misrepresent what took place. A still-pending
        # request that simply timed out without ever being accepted is
        # unaffected: cancelling it is how a stale request gets cleared out.
        if (
            self.instance
            and value == BookingStatus.CANCELLED
            and self.instance.status
            in (BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS)
            and self.instance.time_to
            and self.instance.time_to <= timezone.now()
        ):
            msg = _("This booking has already ended and can no longer be cancelled.")
            raise serializers.ValidationError(msg)

        user = self.context["request"].user

        if (
            self.instance
            and user == self.instance.user
            and value
            not in (
                BookingStatus.CANCELLED,
                BookingStatus.PENDING,
            )
        ):
            msg = _("Invalid status change.")
            raise serializers.ValidationError(msg)

        return value

    def validate_offer(self, value):
        """Ensure that offer can only be updated for pending items"""
        user = self.context["request"].user

        if self.instance and user != self.instance.user:
            msg = _("You cannot set an offer if you're not the owner.")
            raise serializers.ValidationError(msg)

        return value

    def validate_counter_offer(self, value):
        """Ensure that counter_offer can only be changed by the item owner."""
        user = self.context["request"].user

        if self.instance and user == self.instance.user:
            msg = _("You cannot set a counter-offer on your own booking.")
            raise serializers.ValidationError(msg)

        return value


class BookingListSerializer(BookingSerializer):
    item = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Booking
        fields = [
            "id",
            "status",
            "item",
            "item_details",
            "user",
            "created_at",
            "time_from",
            "time_to",
            "unread_messages_count",
            "coin_valuation",
            "coin_valuation_eligible",
        ]


class MessageSerializer(serializers.ModelSerializer):
    """Serializer for Message model. Booking is referenced by UUID."""

    booking = serializers.PrimaryKeyRelatedField(queryset=Booking.objects.all())
    sender = serializers.StringRelatedField(read_only=True)
    remote_sender_actor = RemoteActorMinimalSerializer(read_only=True)

    class Meta:
        model = Message
        fields = [
            "id",
            "booking",
            "sender",
            "remote_sender_actor",
            "created_at",
            "message",
            "is_read",
        ]
        read_only_fields = ["id", "sender", "remote_sender_actor", "created_at"]


def _money_amount(money) -> str | None:
    """Return the decimal amount of a Money value as a string, or None."""
    if money is None:
        return None
    amount = getattr(money, "amount", None)
    return None if amount is None else str(amount)


def _money_currency(money) -> str:
    """Return the ISO currency code of a Money value, or an empty string."""
    if money is None:
        return ""
    return str(getattr(money, "currency", "") or "")


class ItemBookingHistorySerializer(serializers.ModelSerializer):
    """Read-only booking record shown in an item's booking history.

    Exposes only booking information (status, duration, prices) — never any
    conversation/message data. The booker's name is included only for
    authenticated viewers; anonymous viewers see the booking without a name.
    """

    status_display = serializers.CharField(source="get_status_display", read_only=True)
    booker = serializers.SerializerMethodField()
    official_price = serializers.SerializerMethodField()
    official_price_currency = serializers.SerializerMethodField()
    amount_paid = serializers.SerializerMethodField()
    amount_paid_currency = serializers.SerializerMethodField()
    price_unit = serializers.SerializerMethodField()
    rental_price = serializers.SerializerMethodField()
    offer = serializers.SerializerMethodField()
    counter_offer = serializers.SerializerMethodField()

    class Meta:
        model = Booking
        fields = [
            "id",
            "status",
            "status_display",
            "time_from",
            "time_to",
            "official_price",
            "official_price_currency",
            "amount_paid",
            "amount_paid_currency",
            "price_unit",
            "offer",
            "counter_offer",
            "rental_price",
            "booker",
            "created_at",
        ]

    def _viewer_is_authenticated(self) -> bool:
        request = self.context.get("request")
        user = getattr(request, "user", None)
        return bool(user and user.is_authenticated)

    def get_booker(self, obj) -> str | None:
        """Booker display name — only for authenticated viewers."""
        if not self._viewer_is_authenticated():
            return None
        if obj.user_id:
            return obj.user.name or obj.user.username
        actor = obj.remote_booker_actor
        if actor is not None:
            return actor.display_name or actor.username
        return None

    def _paid_money(self, obj):
        """The amount that applied to this booking.

        Prefers an agreed counter-offer, then the booker's offer, then the
        computed rental total, falling back to the item's listed price.
        """
        if obj.counter_offer is not None:
            return obj.counter_offer
        if obj.offer is not None:
            return obj.offer
        rental = obj.rental_price
        if rental is not None:
            return rental
        return obj.item.price

    def get_official_price(self, obj) -> str | None:
        return _money_amount(obj.item.price)

    def get_official_price_currency(self, obj) -> str:
        return _money_currency(obj.item.price)

    def get_amount_paid(self, obj) -> str | None:
        return _money_amount(self._paid_money(obj))

    def get_amount_paid_currency(self, obj) -> str:
        return _money_currency(self._paid_money(obj))

    def get_price_unit(self, obj) -> str:
        """What the amounts in this row are denominated in (money or coins).

        Both the listed price and what was paid follow the item's pricing
        unit, so the history table can render coin-priced rentals in coins
        rather than mislabelling them as currency.
        """
        return obj.item.price_unit

    def get_rental_price(self, obj) -> str | None:
        return _money_amount(obj.rental_price)

    def get_offer(self, obj) -> str | None:
        return _money_amount(obj.offer)

    def get_counter_offer(self, obj) -> str | None:
        return _money_amount(obj.counter_offer)
