from __future__ import annotations

from rest_framework import serializers

from bubble.notifications.channels import (
    default_matrix_id,
    is_backend_configured,
    is_channel_available,
    resolve_target,
)
from bubble.notifications.models import EVENT_GROUPS, NotificationPreference

ProviderType = NotificationPreference.ProviderType

# Channels the user can configure, in display order.
PROVIDERS: tuple[str, ...] = (
    ProviderType.WEBPUSH,
    ProviderType.ROCKETCHAT,
    ProviderType.SIGNAL,
    ProviderType.MATRIX,
    ProviderType.EMAIL,
)


def _toggle_field(provider: str, group: str) -> str:
    return f"{provider}_{group}"


def _configured_field(provider: str) -> str:
    return f"{provider}_configured"


def _available_field(provider: str) -> str:
    return f"{provider}_available"


def _target_field(provider: str) -> str:
    return f"{provider}_target"


class NotificationPreferenceMeSerializer(serializers.Serializer):
    """Flat serializer for GET/PATCH /api/notification-preferences/me/.

    For every provider (webpush, RocketChat, Signal, Matrix, email) it
    exposes:

    * ``<provider>_configured`` (read-only): the channel is set up on the
      backend, independent of whether this particular user is reachable on
      it yet. For the Apprise-backed channels (RocketChat, Signal, Matrix,
      email) that means an Apprise URL template is configured (Constance/env);
      for ``webpush`` it means a VAPID keypair is configured. The frontend
      uses this to decide whether to prefill a user's address for a channel.
    * ``<provider>_available`` (read-only): the channel is configured on the
      backend *and* the user has filled in the field it needs to reach them.
      For ``webpush`` there is no such field — availability means at least one
      of the user's browsers has subscribed.
    * ``<provider>_target`` (read-only): the resolved recipient address. Always
      empty for ``webpush``, which addresses devices rather than an account.
    * ``<provider>_<group>`` (read/write): per event-group opt-in toggles.
      ``messages`` covers new messages and bookings; ``new_item`` covers newly
      created items.

    Additionally exposes ``matrix_default_id`` (read-only): the Matrix ID the
    frontend should prefill for this user (their bubble username on this
    deployment's own homeserver — see ``APPRISE_MATRIX_HOSTNAME``), or "" when
    that can't be determined. Every other channel's target is derived
    automatically (bubble username/email), so only Matrix needs a suggested
    default for the user to accept or edit.
    """

    matrix_default_id = serializers.CharField(read_only=True)

    def get_fields(self):
        fields = super().get_fields()
        for provider in PROVIDERS:
            fields[_configured_field(provider)] = serializers.BooleanField(
                read_only=True
            )
            fields[_available_field(provider)] = serializers.BooleanField(
                read_only=True
            )
            fields[_target_field(provider)] = serializers.CharField(read_only=True)
            for group in EVENT_GROUPS:
                fields[_toggle_field(provider, group)] = serializers.BooleanField(
                    required=False
                )
        return fields

    def to_representation(self, user):
        enabled = {
            (p.provider_type, p.event_type): p.enabled
            for p in NotificationPreference.objects.filter(user=user)
        }

        data: dict[str, object] = {"matrix_default_id": default_matrix_id(user)}
        for provider in PROVIDERS:
            data[_configured_field(provider)] = is_backend_configured(provider)
            data[_available_field(provider)] = is_channel_available(provider, user)
            data[_target_field(provider)] = resolve_target(provider, user)
            for group, events in EVENT_GROUPS.items():
                data[_toggle_field(provider, group)] = all(
                    enabled.get((provider, event), False) for event in events
                )
        return data

    def update(self, user, validated_data):
        for provider in PROVIDERS:
            for group, events in EVENT_GROUPS.items():
                field = _toggle_field(provider, group)
                if field not in validated_data:
                    continue
                value = validated_data[field]
                for event in events:
                    NotificationPreference.objects.update_or_create(
                        user=user,
                        provider_type=provider,
                        event_type=event,
                        defaults={"enabled": value},
                    )
        return user
