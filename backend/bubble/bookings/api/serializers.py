from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from bubble.bookings.models import Booking, BookingStatus, Message
from bubble.items.api.serializers import ItemMinimalSerializer
from bubble.items.models import Item, SalesType
from bubble.users.api.serializers import UserSerializer


class BookingSerializer(serializers.ModelSerializer):
    """Detailed serializer for Booking where `item` is represented only by UUID."""

    item = serializers.PrimaryKeyRelatedField(queryset=Item.objects.published())
    item_details = ItemMinimalSerializer(read_only=True, source="item")
    user = UserSerializer(read_only=True)
    unread_messages_count = serializers.SerializerMethodField()

    class Meta:
        model = Booking
        fields = [
            "id",
            "status",
            "item",
            "item_details",
            "user",
            "time_from",
            "time_to",
            "offer",
            "counter_offer",
            "accepted_by",
            "created_at",
            "updated_at",
            "unread_messages_count",
        ]
        read_only_fields = ["id", "user", "created_at", "updated_at"]

    def get_unread_messages_count(self, obj) -> int | None:
        """Return unread_messages_count if it exists as an annotated field."""
        return getattr(obj, "unread_messages_count", None)

    def validate(self, attrs):
        """
        Validate that if time_to is not set, the item must allow open-ended rentals.
        """
        time_to = attrs.get("time_to")
        item = attrs.get("item")

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
        """Ensure that status is a valid BookingStatus."""
        user = self.context["request"].user

        if (
            self.instance
            and user == self.instance.user
            and value not in (BookingStatus.CANCELLED, BookingStatus.PENDING)
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
        ]


class MessageSerializer(serializers.ModelSerializer):
    """Serializer for Message model. Booking is referenced by UUID."""

    booking = serializers.PrimaryKeyRelatedField(queryset=Booking.objects.all())
    sender = serializers.StringRelatedField(read_only=True)

    class Meta:
        model = Message
        fields = [
            "id",
            "booking",
            "sender",
            "created_at",
            "message",
            "is_read",
        ]
        read_only_fields = ["id", "sender", "created_at"]
