from bubble.notifications.messages import format_notification
from bubble.notifications.models import EventType


def test_new_message_includes_sender_and_message() -> None:
    title, body = format_notification(
        EventType.NEW_MESSAGE,
        {"sender": "bob", "item_title": "Bike", "message": "Is it available?"},
    )
    assert title
    assert "bob" in body
    assert "Bike" in body
    assert "Is it available?" in body


def test_new_booking_includes_item_title() -> None:
    title, body = format_notification(
        EventType.NEW_BOOKING,
        {"item_title": "Drill"},
    )
    assert title
    assert "Drill" in body


def test_new_item_includes_name_and_description() -> None:
    title, body = format_notification(
        EventType.NEW_ITEM,
        {"name": "Ladder", "description": "3m aluminium"},
    )
    assert title
    assert "Ladder" in body
    assert "3m aluminium" in body


def test_unknown_event_has_fallback() -> None:
    title, body = format_notification("something_else", {})
    assert title
    assert "something_else" in body
