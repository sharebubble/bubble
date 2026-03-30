from __future__ import annotations

from rest_framework import serializers

from bubble.notifications.models import NotificationPreference


class NotificationPreferenceMeSerializer(serializers.Serializer):
    """Flat serializer for GET/PATCH /api/notification-preferences/me/.

    Keys are <provider_type>_<event_type> booleans.
    Currently: rocketchat_new_message.
    """

    rocketchat_new_message = serializers.BooleanField(required=False)

    # Map of serializer field name -> (provider_type, event_type)
    FIELD_MAP = {
        "rocketchat_new_message": (
            NotificationPreference.ProviderType.ROCKETCHAT,
            NotificationPreference.EventType.NEW_MESSAGE,
        ),
    }

    def to_representation(self, user):
        """Build a flat dict from the user's NotificationPreference rows."""
        prefs = {
            (p.provider_type, p.event_type): p.enabled
            for p in NotificationPreference.objects.filter(user=user)
        }
        return {
            field: prefs.get((provider, event), False)
            for field, (provider, event) in self.FIELD_MAP.items()
        }

    def update(self, user, validated_data):
        """Upsert NotificationPreference rows for each provided field."""
        for field, (provider, event) in self.FIELD_MAP.items():
            if field in validated_data:
                NotificationPreference.objects.update_or_create(
                    user=user,
                    provider_type=provider,
                    event_type=event,
                    defaults={"enabled": validated_data[field]},
                )
        return user
