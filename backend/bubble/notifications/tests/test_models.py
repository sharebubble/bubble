import pytest

from bubble.notifications.models import (
    CHANNEL_EVENTS,
    EventType,
    NotificationPreference,
)


@pytest.mark.django_db
def test_event_type_field_uses_event_type_choices() -> None:
    choices = NotificationPreference.event_type.field.choices or []
    choice_values = {value for value, _label in choices}

    assert set(EventType.values) == choice_values


def test_channel_events_uses_event_type_constant() -> None:
    assert frozenset({EventType.NEW_ITEM}) == CHANNEL_EVENTS
