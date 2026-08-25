"""Serializers for the payments/ledger API."""

import logging
from decimal import Decimal

from django.conf import settings
from django.utils.translation import gettext_lazy as _
from moneyed import Money
from rest_framework import serializers

from bubble.bookings.models import Booking
from bubble.ledger.models import Transaction
from bubble.ledger.services import (
    LedgerError,
    is_free_booking,
    is_payable_booking,
    record_booking_payment,
)
from bubble.users.models import User

logger = logging.getLogger(__name__)


class PaymentUserSerializer(serializers.ModelSerializer[User]):
    """Public identity of a payer.

    Deliberately narrower than ``users.UserSerializer``: an item's payment
    history is readable by everyone who can see the item, so it must not
    carry email addresses.
    """

    class Meta:
        model = User
        fields = ["id", "username", "name"]


class BookingPaymentSerializer(serializers.ModelSerializer):
    """One recorded payment against a booking.

    Writing takes the booking and the amount; who paid whom follows from the
    booking itself, and the postings are derived server-side.
    """

    booking = serializers.PrimaryKeyRelatedField(queryset=Booking.objects.all())
    # A plain decimal rather than djmoney's MoneyField: the amount does not
    # live on Transaction — it is derived from the postings — and the ledger
    # only ever deals in DEFAULT_CURRENCY.
    amount = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=Decimal("0.01"),
        # Write-only as a field; the read value is put back by
        # ``to_representation`` from the postings.
        write_only=True,
    )
    currency = serializers.SerializerMethodField()
    item = serializers.SerializerMethodField()
    item_name = serializers.SerializerMethodField()
    payer = serializers.SerializerMethodField()
    time_from = serializers.DateTimeField(source="booking.time_from", read_only=True)
    time_to = serializers.DateTimeField(source="booking.time_to", read_only=True)

    class Meta:
        model = Transaction
        fields = [
            "id",
            "booking",
            "item",
            "item_name",
            "payer",
            "amount",
            "currency",
            "voluntary",
            "time_from",
            "time_to",
            "created_at",
        ]
        read_only_fields = ["id", "voluntary", "created_at"]

    def get_currency(self, obj) -> str:
        return str(settings.DEFAULT_CURRENCY)

    def get_item(self, obj) -> str | None:
        return str(obj.booking.item_id) if obj.booking_id else None

    def get_item_name(self, obj) -> str:
        return obj.booking.item.name if obj.booking_id else ""

    @staticmethod
    def _payer_of(obj):
        """The booker — the account money left on this transaction."""
        return obj.booking.user if obj.booking_id else None

    def get_payer(self, obj) -> dict | None:
        payer = self._payer_of(obj)
        return PaymentUserSerializer(payer).data if payer else None

    def to_representation(self, instance):
        """Report the positive amount that reached the owner.

        ``Transaction`` has no amount of its own — the figure people care
        about is the credit leg, so it is read back off the postings.
        """
        data = super().to_representation(instance)
        credit = max(
            (posting.amount for posting in instance.postings.all()),
            key=lambda money: money.amount,
            default=None,
        )
        data["amount"] = None if credit is None else f"{credit.amount:.2f}"
        if credit is not None:
            data["currency"] = str(credit.currency)
        return data

    def validate_booking(self, booking):
        """Only the booker may record what they paid, and only once settled."""
        user = self.context["request"].user
        if booking.user_id != user.pk:
            raise serializers.ValidationError(
                _("You can only record payments for your own bookings.")
            )
        if not is_payable_booking(booking):
            raise serializers.ValidationError(
                _(
                    "This booking cannot be paid for yet. Payments are recorded "
                    "once the booking has completed."
                )
            )
        if booking.user_id == booking.item.user_id:
            raise serializers.ValidationError(
                _("A booking on your own item cannot be paid for.")
            )
        return booking

    def create(self, validated_data):
        booking = validated_data["booking"]
        try:
            return record_booking_payment(
                booking=booking,
                amount=Money(validated_data["amount"], settings.DEFAULT_CURRENCY),
                recorded_by=self.context["request"].user,
                voluntary=is_free_booking(booking),
            )
        except LedgerError:
            # Everything a caller can actually provoke is caught by the
            # validators above, so reaching here means the ledger refused a
            # write for a reason the client cannot act on. Log the detail
            # rather than echoing it back — the message and its traceback are
            # internal, and returning them would leak implementation detail.
            logger.exception("Refused to record a payment for booking %s", booking.pk)
            raise serializers.ValidationError(
                _("This payment could not be recorded.")
            ) from None


class ItemPaymentSummarySerializer(serializers.Serializer):
    """What an item has been paid, in total and on average."""

    item = serializers.UUIDField()
    count = serializers.IntegerField()
    total = serializers.DecimalField(max_digits=12, decimal_places=2)
    average = serializers.DecimalField(max_digits=12, decimal_places=2, allow_null=True)
    currency = serializers.CharField(default=settings.DEFAULT_CURRENCY)


class PaymentSuggestionSerializer(serializers.Serializer):
    """What to pre-fill the payment form with for one booking."""

    booking = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    currency = serializers.CharField()
    # True when the booking has a price to settle, false when the amount is
    # the payer's free choice.
    agreed = serializers.BooleanField()
    # Whether the suggestion came from what this member paid last time.
    from_previous = serializers.BooleanField()


class AccountBalanceSerializer(serializers.Serializer):
    """A member's own balance, derived from their postings."""

    balance = serializers.DecimalField(max_digits=12, decimal_places=2)
    currency = serializers.CharField()
    paid_out = serializers.DecimalField(max_digits=12, decimal_places=2)
    received = serializers.DecimalField(max_digits=12, decimal_places=2)
