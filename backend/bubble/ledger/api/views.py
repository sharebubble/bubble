"""API views for recorded payments and member balances."""

import uuid as uuid_module
from decimal import Decimal

from django.conf import settings
from django.db.models import Avg, Count, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils.translation import gettext_lazy as _
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated, IsAuthenticatedOrReadOnly
from rest_framework.response import Response

from bubble.bookings.models import Booking
from bubble.core.api.pagination import SelectablePageSizePagination
from bubble.items.models import Item
from bubble.ledger.api.serializers import (
    AccountBalanceSerializer,
    BookingPaymentSerializer,
    ItemPaymentSummarySerializer,
    PaymentSuggestionSerializer,
)
from bubble.ledger.models import Account, Posting, Transaction, TransactionKind
from bubble.ledger.services import is_free_booking, suggested_amount

ITEM_PARAM = OpenApiParameter(
    name="item",
    description="UUID of the item whose payment history is requested.",
    required=True,
    type=str,
)
BOOKING_PARAM = OpenApiParameter(
    name="booking",
    description="UUID of the booking a payment would be recorded against.",
    required=True,
    type=str,
)


class BookingPaymentViewSet(
    mixins.CreateModelMixin,
    viewsets.ReadOnlyModelViewSet,
):
    """Payments recorded against bookings.

    Reading an item's payment history is scoped to items the requesting user
    may see, so it is exactly as public as the item itself. Writing is
    limited to the booker of a completed booking; recording again corrects
    the previous figure via a reversing entry rather than editing it.
    """

    lookup_field = "id"
    serializer_class = BookingPaymentSerializer
    permission_classes = [IsAuthenticatedOrReadOnly]
    pagination_class = SelectablePageSizePagination

    def get_queryset(self):
        """Standing booking payments on items visible to this user."""
        return (
            Transaction.objects.filter(
                kind=TransactionKind.BOOKING_PAYMENT,
                reversed_by__isnull=True,
                booking__item__in=self._visible_items(),
            )
            .select_related("booking", "booking__item", "booking__user")
            .prefetch_related("postings")
        )

    def _visible_items(self):
        """Items this user may see — archived ones included.

        A sold item is exactly when its payment history stops growing;
        dropping it there would throw away the record this exists to keep.
        """
        return Item.objects.visible_to(self.request.user, include_archived=True)

    def _requested_item(self) -> Item:
        item_id = self.request.query_params.get("item")
        if not item_id:
            raise ValidationError({"item": _("An 'item' query parameter is required.")})
        try:
            uuid_module.UUID(str(item_id))
        except (ValueError, TypeError, AttributeError) as exc:
            raise ValidationError({"item": _("Not a valid item id.")}) from exc
        return get_object_or_404(self._visible_items(), pk=item_id)

    @extend_schema(parameters=[ITEM_PARAM])
    def list(self, request, *args, **kwargs):
        """Return an item's payment history, newest first."""
        item = self._requested_item()
        queryset = self.get_queryset().filter(booking__item=item)

        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @extend_schema(parameters=[ITEM_PARAM], responses=ItemPaymentSummarySerializer)
    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Return what an item has been paid in total and on average."""
        item = self._requested_item()
        payments = self.get_queryset().filter(booking__item=item)
        # Sum the positive (credit) leg only — the matching debit would
        # cancel it out to zero.
        aggregates = Posting.objects.filter(
            transaction__in=payments, amount__gt=0
        ).aggregate(count=Count("id"), total=Sum("amount"), average=Avg("amount"))

        serializer = ItemPaymentSummarySerializer(
            {
                "item": item.pk,
                "count": aggregates["count"],
                "total": aggregates["total"] or Decimal("0"),
                "average": aggregates["average"],
                "currency": settings.DEFAULT_CURRENCY,
            }
        )
        return Response(serializer.data)

    @extend_schema(parameters=[BOOKING_PARAM], responses=PaymentSuggestionSerializer)
    @action(detail=False, methods=["get"], permission_classes=[IsAuthenticated])
    def suggestion(self, request):
        """Return what to pre-fill the payment form with for a booking.

        A priced booking suggests the amount already agreed. A free one has
        nothing to settle, so it falls back to whatever this member paid for
        the same item last time — repeat borrows need no re-thinking.
        """
        booking_id = request.query_params.get("booking")
        if not booking_id:
            raise ValidationError(
                {"booking": _("A 'booking' query parameter is required.")}
            )
        booking = get_object_or_404(
            Booking.objects.filter(user=request.user).select_related("item"),
            pk=booking_id,
        )

        agreed = suggested_amount(booking)
        amount, from_previous = agreed, False
        if amount is None:
            previous = (
                Posting.objects.filter(
                    transaction__kind=TransactionKind.BOOKING_PAYMENT,
                    transaction__reversed_by__isnull=True,
                    transaction__booking__item=booking.item,
                    transaction__booking__user=request.user,
                    amount__gt=0,
                )
                .order_by("-created_at")
                .first()
            )
            if previous is not None:
                amount, from_previous = previous.amount, True

        serializer = PaymentSuggestionSerializer(
            {
                "booking": booking.pk,
                "amount": getattr(amount, "amount", amount),
                "currency": settings.DEFAULT_CURRENCY,
                "agreed": not is_free_booking(booking),
                "from_previous": from_previous,
            }
        )
        return Response(serializer.data)

    @extend_schema(responses=AccountBalanceSerializer)
    @action(detail=False, methods=["get"], permission_classes=[IsAuthenticated])
    def balance(self, request):
        """Return the requesting member's own balance."""
        account = Account.objects.for_user(request.user)
        totals = account.postings.aggregate(
            balance=Sum("amount"),
            paid_out=Sum("amount", filter=Q(amount__lt=0)),
            received=Sum("amount", filter=Q(amount__gt=0)),
        )

        serializer = AccountBalanceSerializer(
            {
                "balance": totals["balance"] or Decimal("0"),
                "currency": settings.DEFAULT_CURRENCY,
                # Reported as a positive figure — "how much I have paid out".
                "paid_out": -(totals["paid_out"] or Decimal("0")),
                "received": totals["received"] or Decimal("0"),
            }
        )
        return Response(serializer.data)
