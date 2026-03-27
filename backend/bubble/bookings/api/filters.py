import django_filters

from bubble.bookings.models import Booking, BookingStatus, Message


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

    class Meta:
        model = Booking
        fields = ["status", "item", "user", "created_at_after", "created_at_before"]


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
