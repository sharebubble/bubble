import django_filters
from django.db.models import Q
from django.utils import timezone
from guardian.shortcuts import get_objects_for_user

from bubble.bookings.models import Booking, BookingStatus, Message
from bubble.items.models import SalesType


class BookingFilter(django_filters.FilterSet):
    # Allow filtering by multiple statuses (e.g. ?status=1,2)
    status = django_filters.MultipleChoiceFilter(
        field_name="status", choices=BookingStatus.choices, conjoined=False
    )
    item = django_filters.UUIDFilter(field_name="item__id")
    user = django_filters.UUIDFilter(field_name="user__id")
    created_at_after = django_filters.IsoDateTimeFilter(
        field_name="created_at", lookup_expr="gte"
    )
    created_at_before = django_filters.IsoDateTimeFilter(
        field_name="created_at", lookup_expr="lte"
    )
    time_from_after = django_filters.IsoDateTimeFilter(
        field_name="time_from", lookup_expr="gte"
    )
    time_from_before = django_filters.IsoDateTimeFilter(
        field_name="time_from", lookup_expr="lte"
    )
    time_to_after = django_filters.IsoDateTimeFilter(
        field_name="time_to", lookup_expr="gte"
    )
    time_to_before = django_filters.IsoDateTimeFilter(
        field_name="time_to", lookup_expr="lte"
    )
    time_to_isnull = django_filters.BooleanFilter(
        field_name="time_to", lookup_expr="isnull"
    )
    # role=owner  → only bookings on items the current user owns (has change_item perm)
    # role=renter → only bookings where the current user is the requester
    role = django_filters.CharFilter(
        method="filter_role", label="Role filter (owner/renter)"
    )
    # temporal=upcoming → current + future bookings (not yet ended)
    # temporal=active   → currently running bookings
    # temporal=past     → bookings that have already ended
    temporal = django_filters.ChoiceFilter(
        choices=[
            ("upcoming", "Upcoming"),
            ("active", "Active"),
            ("past", "Past"),
        ],
        method="filter_temporal",
        label="Temporal filter (upcoming/active/past)",
    )

    class Meta:
        model = Booking
        fields = [
            "status",
            "item",
            "user",
            "created_at_after",
            "created_at_before",
            "time_from_after",
            "time_from_before",
            "time_to_after",
            "time_to_before",
            "time_to_isnull",
            "role",
            "temporal",
        ]

    def filter_role(self, queryset, name, value):
        request = self.request
        if not request or not request.user or not request.user.is_authenticated:
            return queryset.none()

        if value == "owner":
            # Items the current user has change_item permission on (guardian)
            owned_items = get_objects_for_user(
                request.user, "items.change_item", accept_global_perms=False
            )
            return queryset.filter(item__in=owned_items)
        if value == "renter":
            # Bookings where the current user is the requester
            return queryset.filter(user=request.user)

        return queryset

    # Sale-type bookings (sell, donate, want_buy) have no rental period, so
    # they never get a time_to. Whether one has "ended" is determined by its
    # status reaching a terminal state, not by comparing time_from to now
    # (which would wrongly mark a still-pending/confirmed sale as past).
    SALE_TYPES = (SalesType.SELL, SalesType.DONATE, SalesType.WANT_BUY)
    TERMINAL_STATUSES = (
        BookingStatus.COMPLETED,
        BookingStatus.CANCELLED,
        BookingStatus.REJECTED,
    )

    def filter_temporal(self, queryset, name, value):
        """Split bookings relative to the current time for the agenda view.

        An open-ended booking (``time_to`` is null) is treated as not-yet-ended
        for rentals, so it counts as upcoming/active but never as past. Ended
        sale-type bookings (no time_to, but a terminal status) are the
        exception: they're always "past" and never upcoming/active.
        """
        now = timezone.now()
        ended_sale = Q(
            item__sales_type__in=self.SALE_TYPES,
            status__in=self.TERMINAL_STATUSES,
            time_to__isnull=True,
        )
        if value == "past":
            # Already ended.
            return queryset.filter(Q(time_to__lt=now) | ended_sale)
        if value == "upcoming":
            # Current + future: anything that has not ended yet.
            return queryset.filter(
                Q(time_to__gte=now) | Q(time_to__isnull=True)
            ).exclude(ended_sale)
        if value == "active":
            # Currently running: started and not yet ended.
            return queryset.filter(
                Q(time_from__lte=now) & (Q(time_to__gte=now) | Q(time_to__isnull=True))
            ).exclude(ended_sale)
        return queryset


class MessageFilter(django_filters.FilterSet):
    booking = django_filters.UUIDFilter(field_name="booking__id")
    sender = django_filters.UUIDFilter(field_name="sender__id")
    created_at_after = django_filters.IsoDateTimeFilter(
        field_name="created_at", lookup_expr="gte"
    )
    created_at_before = django_filters.IsoDateTimeFilter(
        field_name="created_at", lookup_expr="lte"
    )
    is_read = django_filters.BooleanFilter(field_name="is_read")
    unread_received = django_filters.BooleanFilter(
        method="filter_unread_received",
        label="Unread messages received by current user",
    )

    class Meta:
        model = Message
        fields = ["booking", "sender", "created_at_after", "created_at_before"]

    def filter_unread_received(self, queryset, name, value):
        """
        Filter messages that are unread and not sent by the current user.
        When value is True, returns unread messages from other users.
        When value is False, returns all other messages (read or sent by user).
        """
        if not value:
            # If False, don't apply this filter (return all messages)
            return queryset

        # Get the current user from the request
        request = self.request
        if not request or not request.user or not request.user.is_authenticated:
            # If no authenticated user, return empty queryset
            return queryset.none()

        # Filter for messages that are:
        # 1. Not sent by the current user
        # 2. Marked as unread
        return queryset.exclude(sender=request.user).filter(is_read=False)
