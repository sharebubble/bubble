import pytest
from constance.test import override_config

from bubble.notifications.api.serializers import NotificationPreferenceMeSerializer
from bubble.notifications.models import EventType, NotificationPreference
from bubble.users.tests.factories import UserFactory

ROCKET_URL = "rocket://user:pass@chat.example.com/@{target}"


@pytest.mark.django_db
@override_config(APPRISE_ROCKETCHAT_URL=ROCKET_URL)
def test_to_representation_reports_availability_and_toggles() -> None:
    user = UserFactory(username="alice")
    NotificationPreference.objects.update_or_create(
        user=user,
        provider_type=NotificationPreference.ProviderType.ROCKETCHAT,
        event_type=EventType.NEW_MESSAGE,
        defaults={"enabled": True},
    )
    NotificationPreference.objects.update_or_create(
        user=user,
        provider_type=NotificationPreference.ProviderType.ROCKETCHAT,
        event_type=EventType.NEW_BOOKING,
        defaults={"enabled": True},
    )

    data = NotificationPreferenceMeSerializer().to_representation(user)

    assert data["rocketchat_available"] is True
    assert data["rocketchat_target"] == "alice"
    # messages group is on only when *all* underlying events are enabled
    assert data["rocketchat_messages"] is True
    assert data["rocketchat_new_item"] is False
    # signal/email are not configured → unavailable
    assert data["signal_available"] is False
    assert data["email_available"] is False


@pytest.mark.django_db
@override_config(APPRISE_ROCKETCHAT_URL=ROCKET_URL)
def test_messages_toggle_writes_message_and_booking_events() -> None:
    user = UserFactory(username="alice")
    serializer = NotificationPreferenceMeSerializer(data={"rocketchat_messages": True})
    assert serializer.is_valid(), serializer.errors

    serializer.update(user, serializer.validated_data)

    events = set(
        NotificationPreference.objects.filter(
            user=user,
            provider_type="rocketchat",
            enabled=True,
        ).values_list("event_type", flat=True)
    )
    assert events == {EventType.NEW_MESSAGE, EventType.NEW_BOOKING}


@pytest.mark.django_db
@override_config(APPRISE_ROCKETCHAT_URL=ROCKET_URL)
def test_new_item_toggle_round_trips() -> None:
    user = UserFactory(username="alice")
    serializer = NotificationPreferenceMeSerializer(data={"rocketchat_new_item": True})
    assert serializer.is_valid(), serializer.errors
    serializer.update(user, serializer.validated_data)

    data = NotificationPreferenceMeSerializer().to_representation(user)
    assert data["rocketchat_new_item"] is True
    assert data["rocketchat_messages"] is False
