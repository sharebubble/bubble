import pytest

from bubble.notifications.api.serializers import NotificationPreferenceMeSerializer
from bubble.notifications.models import EventType, NotificationPreference
from bubble.users.tests.factories import UserFactory


@pytest.mark.django_db
def test_to_representation_returns_boolean_flag_from_preferences() -> None:
    user = UserFactory()
    NotificationPreference.objects.create(
        user=user,
        provider_type=NotificationPreference.ProviderType.ROCKETCHAT,
        event_type=EventType.NEW_MESSAGE,
        enabled=True,
    )

    serializer = NotificationPreferenceMeSerializer()
    data = serializer.to_representation(user)

    assert data == {"rocketchat_new_message": True}


@pytest.mark.django_db
def test_update_upserts_preference_using_event_type_constant() -> None:
    user = UserFactory()
    serializer = NotificationPreferenceMeSerializer(
        data={"rocketchat_new_message": True}
    )
    assert serializer.is_valid(), serializer.errors

    serializer.update(user, serializer.validated_data)

    pref = NotificationPreference.objects.get(user=user)
    assert pref.provider_type == NotificationPreference.ProviderType.ROCKETCHAT
    assert pref.event_type == EventType.NEW_MESSAGE
    assert pref.enabled is True
