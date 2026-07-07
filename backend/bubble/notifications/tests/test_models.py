import pytest

from bubble.notifications.models import (
    EVENT_GROUPS,
    EventType,
    NotificationPreference,
)


@pytest.mark.django_db
def test_event_type_field_uses_event_type_choices() -> None:
    choices = NotificationPreference.event_type.field.choices or []
    choice_values = {value for value, _label in choices}

    assert set(EventType.values) == choice_values


def test_event_groups_only_reference_known_event_types() -> None:
    grouped = {event for events in EVENT_GROUPS.values() for event in events}
    assert grouped == set(EventType.values)


def test_messages_group_covers_messages_and_bookings() -> None:
    assert set(EVENT_GROUPS["messages"]) == {
        EventType.NEW_MESSAGE,
        EventType.NEW_BOOKING,
    }


def test_provider_types_include_apprise_channels() -> None:
    providers = set(NotificationPreference.ProviderType.values)
    assert {"rocketchat", "signal", "matrix", "email"} <= providers
