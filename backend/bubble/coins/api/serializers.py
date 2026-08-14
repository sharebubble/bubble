"""Serializers for the community-coin API."""

from decimal import Decimal

from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from bubble.bookings.models import Booking
from bubble.coins.models import (
    CoinValuation,
    is_rental_item,
    is_valuable_booking,
    rental_total,
)
from bubble.users.models import User

# Coin amounts share the shape of the model fields; declared once so the
# writable inputs and the read-only summary agree on precision.
coin_amount_kwargs = {"max_digits": 10, "decimal_places": 2, "min_value": Decimal("0")}


class CoinUserSerializer(serializers.ModelSerializer[User]):
    """Public identity of the person behind a valuation.

    Deliberately narrower than ``users.UserSerializer``: an item's track
    record is readable by everyone who can see the item, so it must not carry
    email addresses.
    """

    class Meta:
        model = User
        fields = ["id", "username", "name"]


class CoinValuationSerializer(serializers.ModelSerializer):
    """A single entry of an item's coin track record.

    Writing takes only ``booking`` plus the value the user picked: ``rate``
    (per rental period) for rentals, ``amount`` (lump sum) for everything
    else. Item, user and the resulting total are derived server-side.
    """

    booking = serializers.PrimaryKeyRelatedField(queryset=Booking.objects.all())
    item = serializers.PrimaryKeyRelatedField(read_only=True)
    item_name = serializers.CharField(source="item.name", read_only=True)
    user = CoinUserSerializer(read_only=True)
    amount = serializers.DecimalField(**coin_amount_kwargs, required=False)
    rate = serializers.DecimalField(
        **coin_amount_kwargs, required=False, allow_null=True
    )
    time_from = serializers.DateTimeField(source="booking.time_from", read_only=True)
    time_to = serializers.DateTimeField(source="booking.time_to", read_only=True)

    class Meta:
        model = CoinValuation
        fields = [
            "id",
            "booking",
            "item",
            "item_name",
            "user",
            "amount",
            "rate",
            "rental_period",
            "time_from",
            "time_to",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "item",
            "user",
            "rental_period",
            "created_at",
            "updated_at",
        ]

    def validate_booking(self, booking):
        """Only the booker of a settled, free transaction may value it."""
        user = self.context["request"].user
        if booking.user_id != user.pk:
            raise serializers.ValidationError(
                _("You can only value your own transactions.")
            )
        if not is_valuable_booking(booking):
            raise serializers.ValidationError(
                _(
                    "This transaction cannot be valued in coins. Only settled "
                    "bookings on items offered without a price qualify."
                )
            )
        return booking

    def validate(self, attrs):
        """Derive the stored total from whichever value the item calls for."""
        booking = attrs["booking"]
        item = booking.item

        if is_rental_item(item):
            rate = attrs.get("rate")
            if rate is None:
                raise serializers.ValidationError(
                    {"rate": _("A price per rental period is required for rentals.")}
                )
            attrs["rate"] = rate
            attrs["amount"] = rental_total(booking, rate)
            attrs["rental_period"] = item.rental_period
        else:
            amount = attrs.get("amount")
            if amount is None:
                raise serializers.ValidationError(
                    {"amount": _("A total price is required.")}
                )
            attrs["rate"] = None
            attrs["rental_period"] = ""

        attrs["item"] = item
        attrs["user"] = self.context["request"].user
        return super().validate(attrs)

    def create(self, validated_data):
        """Record the valuation, replacing any earlier one on this booking.

        Re-valuing a transaction is an ordinary correction rather than a new
        entry in the track record, so the write is an upsert on the booking.
        """
        booking = validated_data.pop("booking")
        valuation, _created = CoinValuation.objects.update_or_create(
            booking=booking,
            defaults=validated_data,
        )
        return valuation


class CoinTrackRecordSummarySerializer(serializers.Serializer):
    """Aggregated coin track record of a single item."""

    item = serializers.UUIDField()
    count = serializers.IntegerField()
    total = serializers.DecimalField(max_digits=12, decimal_places=2)
    average = serializers.DecimalField(max_digits=12, decimal_places=2, allow_null=True)


class CoinValuationSuggestionSerializer(serializers.Serializer):
    """The value a user last picked for an item, used to pre-fill the slider."""

    item = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    rate = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    rental_period = serializers.CharField(allow_blank=True)
    has_previous = serializers.BooleanField()
