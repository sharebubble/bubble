from django.db import IntegrityError, transaction
from django.db.models import Count, Max, Q
from django.utils.translation import gettext_lazy as _
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import (
    DjangoModelPermissions,
    IsAuthenticated,
    IsAuthenticatedOrReadOnly,
)
from rest_framework.response import Response

from bubble.bookings.api.filters import BookingFilter, MessageFilter
from bubble.bookings.api.serializers import (
    BookingListSerializer,
    BookingSerializer,
    MessageSerializer,
)
from bubble.bookings.models import Booking, BookingStatus, Message
from bubble.core.api.pagination import SelectablePageSizePagination
from bubble.items.models import ItemStatus, SalesType


class PublicBookingViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Public read-only ViewSet for confirmed bookings.

    This viewset only returns bookings with CONFIRMED status and is read-only.
    Supports filtering via BookingFilter.
    """

    lookup_field = "id"
    serializer_class = BookingSerializer
    pagination_class = SelectablePageSizePagination
    filter_backends = [
        DjangoFilterBackend,
        filters.OrderingFilter,
        filters.SearchFilter,
    ]
    filterset_class = BookingFilter
    search_fields = ["item__name", "user__username"]
    ordering_fields = ["created_at", "updated_at", "time_from", "time_to"]
    ordering = ["-created_at"]
    permission_classes = [IsAuthenticatedOrReadOnly]

    def get_serializer_class(self):
        if self.action in ("list",):
            return BookingListSerializer
        return BookingSerializer

    def get_queryset(self):
        """Return only confirmed bookings."""
        return Booking.objects.filter(status=BookingStatus.CONFIRMED).select_related(
            "item", "user", "accepted_by"
        )


class BookingViewSet(viewsets.ModelViewSet, PublicBookingViewSet):
    """ViewSet for bookings with filtering and permissions."""

    permission_classes = [DjangoModelPermissions]
    ordering = ["-latest_message_at"]

    def get_queryset(self):
        return (
            Booking.objects.get_for_user(self.request.user)
            .select_related("item", "user", "accepted_by")
            .annotate(
                unread_messages_count=Count(
                    "messages",
                    filter=Q(messages__is_read=False)
                    & ~Q(messages__sender=self.request.user),
                ),
                latest_message_at=Max("messages__created_at"),
            )
        )

    def perform_create(self, serializer):
        """
        Create a booking and auto-confirm if the item has rental_self_service enabled
        and the offered price matches the item's listed price exactly.

        If the offer deviates from the item price the booking stays PENDING so the
        owner can review the custom offer, even on self-service items.
        """
        item = serializer.validated_data.get("item")
        offer = serializer.validated_data.get("offer")

        # Owner/co-owner bookings are always auto-confirmed regardless of offer.
        is_owner = item and self.request.user.has_perm("change_item", item)

        serializer.save(user=self.request.user)

        booking = serializer.instance

        rental_price = booking.rental_price
        self_service_at_listed_price = (
            item
            and item.rental_self_service
            and (
                (rental_price and offer and offer >= rental_price)
                or (not rental_price and not offer)
            )
        )

        if is_owner or self_service_at_listed_price:
            booking.status = BookingStatus.CONFIRMED
            try:
                booking.save(update_fields=["status"])
            except IntegrityError as exc:
                exc_str = str(exc)
                if "exclude_overlapping_confirmed_bookings" in exc_str:
                    raise ValidationError(
                        {
                            "non_field_errors": [
                                _(
                                    "This item is already rented out or has an open"
                                    " rental for the requested period."
                                    " Please choose a different time."
                                )
                            ]
                        }
                    ) from exc
                raise

        message = _("Booking request created for {offer}").format(offer=booking.offer)
        Message.objects.create(
            booking=booking, sender=self.request.user, message=message
        )

    def perform_update(self, serializer):
        super().perform_update(serializer)

        booking = serializer.instance

        if "status" in serializer.validated_data:
            message = _("Booking status updated to {status}").format(
                status=booking.get_status_display()
            )
        else:
            message = _("Booking updated: {fields_updated}").format(
                fields_updated=", ".join(
                    [
                        f"{booking._meta.get_field(field).verbose_name}: {value}"  # noqa: SLF001
                        for field, value in serializer.validated_data.items()
                    ]
                )
            )
        Message.objects.create(
            booking=booking, sender=self.request.user, message=message
        )

    # --- Fulfillment: confirm the physical exchange of the item ---------------

    SALE_TYPES = (SalesType.SELL, SalesType.DONATE)
    RENTAL_TYPES = (SalesType.RENT, SalesType.BORROW)

    @action(detail=True, methods=["post"])
    def confirm_received(self, request, id=None):  # noqa: A002
        """Booker confirms they received the item.

        For a sale this transfers ownership of the item to the booker and
        completes the booking. For a rental it starts the rental: the item
        becomes RENTED and the booking moves to IN_PROGRESS.
        """
        booking = self.get_object()

        if request.user != booking.user:
            raise PermissionDenied(
                _("Only the booker can confirm they received the item.")
            )
        if booking.status != BookingStatus.CONFIRMED:
            raise ValidationError(
                _("The item can only be confirmed as received for a confirmed booking.")
            )

        item = booking.item
        sales_type = item.sales_type

        with transaction.atomic():
            if sales_type in self.SALE_TYPES:
                item.transfer_ownership(booking.user)
                booking.status = BookingStatus.COMPLETED
            elif sales_type in self.RENTAL_TYPES:
                item.status = ItemStatus.RENTED
                item.save(update_fields=["status"])
                booking.status = BookingStatus.IN_PROGRESS
            else:
                raise ValidationError(
                    _("Fulfillment is not supported for this listing type.")
                )

            booking.save(update_fields=["status"])

        # The hand-over is recorded as a booking message: its sender and
        # created_at capture who confirmed and when.
        Message.objects.create(
            booking=booking,
            sender=request.user,
            message=_("Item confirmed as received."),
        )
        serializer = self.get_serializer(booking)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def confirm_returned(self, request, id=None):  # noqa: A002
        """Owner confirms a rented item was returned, completing the rental.

        Any user with ``change_item`` permission (owner or co-owner) may confirm.
        The item becomes AVAILABLE again and the booking is COMPLETED.
        """
        booking = self.get_object()

        if not request.user.has_perm("change_item", booking.item):
            raise PermissionDenied(
                _("Only the item owner can confirm the item was returned.")
            )
        if booking.status != BookingStatus.IN_PROGRESS:
            raise ValidationError(
                _("Only an in-progress rental can be confirmed as returned.")
            )

        item = booking.item
        with transaction.atomic():
            item.status = ItemStatus.AVAILABLE
            item.save(update_fields=["status"])
            booking.status = BookingStatus.COMPLETED
            booking.save(update_fields=["status"])

        # The return is recorded as a booking message: its sender and created_at
        # capture who confirmed and when.
        Message.objects.create(
            booking=booking,
            sender=request.user,
            message=_("Item confirmed as returned."),
        )
        serializer = self.get_serializer(booking)
        return Response(serializer.data, status=status.HTTP_200_OK)


class MessageViewSet(viewsets.ModelViewSet):
    """ViewSet for messages related to bookings.

    List requires either `booking` (booking-uuid) or `user` (user id) query param
    to be provided to avoid returning global message lists.
    """

    lookup_field = "id"
    queryset = Message.objects.select_related("booking", "sender").all()
    serializer_class = MessageSerializer
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_class = MessageFilter
    ordering_fields = ["created_at", "sender"]
    ordering = ["-created_at"]
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        bookings_for_user = Booking.objects.get_for_user(self.request.user)
        return self.queryset.filter(booking__in=bookings_for_user)

    def perform_create(self, serializer):
        serializer.save(sender=self.request.user)

    def perform_update(self, serializer):
        if serializer.validated_data.get("is_read"):
            # Only allow marking as read, not un-reading
            if serializer.instance.is_read:
                return
            serializer.save(is_read=True)
        else:
            msg = _("Only 'is_read' field can be updated.")
            raise ValidationError(msg)
