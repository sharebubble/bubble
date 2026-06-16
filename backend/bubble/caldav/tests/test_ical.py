"""Unit tests for the hand-rolled iCalendar serializer/parser."""

import datetime as dt
from datetime import UTC

from django.test import SimpleTestCase

from bubble.caldav.ical import (
    MAX_LINE_OCTETS,
    VEvent,
    build_calendar,
    escape_text,
    fold_line,
    format_utc,
    parse_calendar,
)


class EscapeAndFoldTests(SimpleTestCase):
    def test_escape_text(self):
        assert escape_text("a,b;c\\d\ne") == "a\\,b\\;c\\\\d\\ne"

    def test_fold_short_line_unchanged(self):
        line = "SUMMARY:hello"
        assert fold_line(line) == line

    def test_fold_long_line_wraps_at_75_octets(self):
        line = "DESCRIPTION:" + ("x" * 200)
        folded = fold_line(line)
        physical = folded.split("\r\n")
        assert len(physical[0].encode("utf-8")) <= MAX_LINE_OCTETS
        for cont in physical[1:]:
            assert cont.startswith(" ")
        # Unfolding restores the original.
        rejoined = physical[0] + "".join(c[1:] for c in physical[1:])
        assert rejoined == line

    def test_fold_does_not_split_multibyte(self):
        line = "SUMMARY:" + ("é" * 60)
        folded = fold_line(line)
        # Each physical line must still decode cleanly.
        for piece in folded.split("\r\n"):
            piece.encode("utf-8").decode("utf-8")


class FormatTests(SimpleTestCase):
    def test_format_utc_from_aware(self):
        d = dt.datetime(2026, 6, 16, 10, 30, tzinfo=UTC)
        assert format_utc(d) == "20260616T103000Z"

    def test_format_utc_from_naive_uses_server_tz(self):
        # Europe/Vienna is UTC+2 in June → 12:30 local == 10:30 UTC.
        d = dt.datetime(2026, 6, 16, 12, 30)  # noqa: DTZ001 — naive input under test
        assert format_utc(d) == "20260616T103000Z"


class BuildCalendarTests(SimpleTestCase):
    def test_build_calendar_contains_name_and_event(self):
        ev = VEvent(
            uid="abc@bubble",
            dtstart=dt.datetime(2026, 6, 16, 8, 0, tzinfo=UTC),
            dtend=dt.datetime(2026, 6, 16, 9, 0, tzinfo=UTC),
            summary="Drill",
            description="Alice",
            status="TENTATIVE",
        )
        ics = build_calendar("Drill", [ev])
        assert "BEGIN:VCALENDAR" in ics
        assert "X-WR-CALNAME:Drill" in ics
        assert "NAME:Drill" in ics
        assert "STATUS:TENTATIVE" in ics
        assert "SUMMARY:Drill" in ics
        assert "DESCRIPTION:Alice" in ics
        # Tentative events are advertised as free/transparent.
        assert "TRANSP:TRANSPARENT" in ics
        assert ics.endswith("\r\n")

    def test_confirmed_event_is_opaque(self):
        ev = VEvent(
            uid="x@bubble",
            dtstart=dt.datetime(2026, 6, 16, 8, 0, tzinfo=UTC),
            status="CONFIRMED",
        )
        ics = build_calendar("X", [ev])
        assert "TRANSP:OPAQUE" in ics


class ParseTests(SimpleTestCase):
    def test_parse_roundtrip(self):
        ics = (
            "BEGIN:VCALENDAR\r\n"
            "VERSION:2.0\r\n"
            "BEGIN:VEVENT\r\n"
            "UID:my-uid-123\r\n"
            "DTSTART:20260616T080000Z\r\n"
            "DTEND:20260616T100000Z\r\n"
            "SUMMARY:Borrow the drill\r\n"
            "DESCRIPTION:line1\\nline2\r\n"
            "END:VEVENT\r\n"
            "END:VCALENDAR\r\n"
        )
        events = parse_calendar(ics)
        assert len(events) == 1
        ev = events[0]
        assert ev.uid == "my-uid-123"
        assert ev.dtstart == dt.datetime(2026, 6, 16, 8, 0, tzinfo=UTC)
        assert ev.dtend == dt.datetime(2026, 6, 16, 10, 0, tzinfo=UTC)
        assert ev.summary == "Borrow the drill"
        assert ev.description == "line1\nline2"

    def test_parse_folded_lines(self):
        ics = (
            "BEGIN:VEVENT\r\n"
            "UID:folded\r\n"
            "DTSTART:20260616T080000Z\r\n"
            "SUMMARY:Hello \r\n World\r\n"
            "END:VEVENT\r\n"
        )
        events = parse_calendar(ics)
        assert events[0].summary == "Hello World"
