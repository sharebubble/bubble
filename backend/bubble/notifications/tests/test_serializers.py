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

    assert data["rocketchat_configured"] is True
    assert data["rocketchat_available"] is True
    assert data["rocketchat_target"] == "alice"
    # messages group is on only when *all* underlying events are enabled
    assert data["rocketchat_messages"] is True
    assert data["rocketchat_new_item"] is False
    # signal/email are not configured → unavailable
    assert data["signal_configured"] is False
    assert data["signal_available"] is False
    assert data["email_configured"] is False
    assert data["email_available"] is False


@pytest.mark.django_db
@override_config(APPRISE_MATRIX_URL="matrixs://user:pass@matrix.example.com/{target}")
def test_configured_is_true_even_without_a_user_target() -> None:
    # "configured" reflects backend setup only, unlike "available" which also
    # requires the user to have filled in their address for the channel.
    user = UserFactory(username="alice")

    data = NotificationPreferenceMeSerializer().to_representation(user)

    assert data["matrix_configured"] is True
    assert data["matrix_available"] is False
    assert data["matrix_target"] == ""


@pytest.mark.django_db
@override_config(APPRISE_MAILTOS_URL="mailtos://user:pass@smtp.example.com?to={target}")
def test_email_is_available_but_disabled_by_default() -> None:
    # Unlike RocketChat, email gets no default-enabled preference row on
    # signup — it only ever turns on when the user opts in themselves.
    user = UserFactory(username="alice", email="alice@example.com")

    data = NotificationPreferenceMeSerializer().to_representation(user)

    assert data["email_configured"] is True
    assert data["email_available"] is True
    assert data["email_target"] == "alice@example.com"
    assert data["email_messages"] is False
    assert data["email_new_item"] is False


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
