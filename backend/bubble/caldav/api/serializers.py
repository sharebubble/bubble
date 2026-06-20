"""Serializers describing calendar-link management responses (schema only)."""

from rest_framework import serializers


class FeedLinkSerializer(serializers.Serializer):
    """Public read-only feed (item or collection)."""

    kind = serializers.CharField()
    feed_url = serializers.URLField()
    webcal_url = serializers.CharField()
    can_manage = serializers.BooleanField()
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()


class PersonalCalendarSerializer(serializers.Serializer):
    """Private read-write CalDAV endpoint for the current user."""

    kind = serializers.CharField()
    caldav_url = serializers.URLField()
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()
