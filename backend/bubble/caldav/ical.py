"""Minimal, dependency-free iCalendar (RFC 5545) serialization and parsing.

We deliberately hand-roll a small subset rather than pull in a third-party
library: we only need to emit/parse VEVENTs for bookings, and keeping it in the
repo avoids adding a dependency to the lockfile.
"""

import datetime as dt
import logging
from datetime import UTC
from zoneinfo import ZoneInfo

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

PRODID = "-//Bubble//Calendar//EN"

# RFC 5545 content lines must not exceed 75 octets (excluding CRLF).
MAX_LINE_OCTETS = 75
# UTF-8 continuation bytes match 0b10xxxxxx.
UTF8_CONTINUATION_MASK = 0xC0
UTF8_CONTINUATION_BYTE = 0x80
# Length of a bare iCalendar DATE value (YYYYMMDD).
DATE_VALUE_LENGTH = 8


def _server_tz() -> ZoneInfo:
    return ZoneInfo(settings.TIME_ZONE)


def escape_text(value: str) -> str:
    """Escape a TEXT value per RFC 5545 §3.3.11."""
    if value is None:
        return ""
    return (
        str(value)
        .replace("\\", "\\\\")
        .replace("\n", "\\n")
        .replace("\r", "")
        .replace(",", "\\,")
        .replace(";", "\\;")
    )


def fold_line(line: str) -> str:
    """Fold a content line to <=75 octets per RFC 5545 §3.1.

    Continuation lines start with a single space. Folding operates on octets,
    so we work on the UTF-8 encoded bytes and avoid splitting a multi-byte
    character across a fold.
    """
    encoded = line.encode("utf-8")
    if len(encoded) <= MAX_LINE_OCTETS:
        return line

    chunks = []
    # First line: 75 octets. Continuation lines: 74 octets (one reserved for
    # the leading space).
    limit = MAX_LINE_OCTETS
    start = 0
    while start < len(encoded):
        end = min(start + limit, len(encoded))
        # Don't split inside a UTF-8 multibyte sequence: back off while the
        # next byte is a continuation byte (0b10xxxxxx).
        while (
            end < len(encoded)
            and (encoded[end] & UTF8_CONTINUATION_MASK) == UTF8_CONTINUATION_BYTE
        ):
            end -= 1
        chunks.append(encoded[start:end])
        start = end
        limit = MAX_LINE_OCTETS - 1
    return "\r\n ".join(chunk.decode("utf-8") for chunk in chunks)


def format_utc(value: dt.datetime) -> str:
    """Format a datetime as a UTC iCalendar DATE-TIME (``...Z``)."""
    if timezone.is_naive(value):
        value = timezone.make_aware(value, _server_tz())
    return value.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


class VEvent:
    """A single calendar event."""

    def __init__(  # noqa: PLR0913 — keyword-only fields of a small value object
        self,
        *,
        uid: str,
        dtstart: dt.datetime,
        dtend: dt.datetime | None = None,
        summary: str = "",
        description: str = "",
        status: str = "CONFIRMED",
        dtstamp: dt.datetime | None = None,
        sequence: int = 0,
        last_modified: dt.datetime | None = None,
    ):
        self.uid = uid
        self.dtstart = dtstart
        self.dtend = dtend
        self.summary = summary
        self.description = description
        self.status = status
        self.dtstamp = dtstamp or timezone.now()
        self.sequence = sequence
        self.last_modified = last_modified

    def to_lines(self) -> list[str]:
        lines = [
            "BEGIN:VEVENT",
            f"UID:{escape_text(self.uid)}",
            f"DTSTAMP:{format_utc(self.dtstamp)}",
            f"DTSTART:{format_utc(self.dtstart)}",
        ]
        if self.dtend is not None:
            lines.append(f"DTEND:{format_utc(self.dtend)}")
        lines.append(f"SUMMARY:{escape_text(self.summary)}")
        if self.description:
            lines.append(f"DESCRIPTION:{escape_text(self.description)}")
        if self.status:
            lines.append(f"STATUS:{self.status}")
        lines.append(f"SEQUENCE:{self.sequence}")
        # TENTATIVE bookings are not yet blocking, so mark them as free time.
        transp = "TRANSPARENT" if self.status == "TENTATIVE" else "OPAQUE"
        lines.append(f"TRANSP:{transp}")
        if self.last_modified is not None:
            lines.append(f"LAST-MODIFIED:{format_utc(self.last_modified)}")
        lines.append("END:VEVENT")
        return lines

    def to_ics(self) -> str:
        return "\r\n".join(fold_line(line) for line in self.to_lines())


def build_calendar(name: str, events: list[VEvent]) -> str:
    """Wrap events in a VCALENDAR. ``name`` becomes the calendar display name."""
    lines = [
        "BEGIN:VCALENDAR",
        f"PRODID:{PRODID}",
        "VERSION:2.0",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        # X-WR-CALNAME is widely supported; NAME is the RFC 7986 equivalent.
        f"X-WR-CALNAME:{escape_text(name)}",
        f"NAME:{escape_text(name)}",
    ]
    for event in events:
        lines.extend(event.to_lines())
    lines.append("END:VCALENDAR")
    return "\r\n".join(fold_line(line) for line in lines) + "\r\n"


# ---------------------------------------------------------------------------
# Parsing (used when a CalDAV client PUTs a new event)
# ---------------------------------------------------------------------------


def _unfold(text: str) -> list[str]:
    """Unfold folded content lines into logical lines."""
    raw_lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    logical: list[str] = []
    for raw in raw_lines:
        if raw[:1] in (" ", "\t") and logical:
            logical[-1] += raw[1:]
        else:
            logical.append(raw)
    return logical


def _parse_dt(value: str, params: dict[str, str]) -> dt.datetime:
    """Parse an iCalendar DATE/DATE-TIME value into an aware datetime."""
    value = value.strip()
    is_date_only = len(value) == DATE_VALUE_LENGTH and "T" not in value
    if is_date_only:
        naive = dt.datetime.strptime(value, "%Y%m%d")  # noqa: DTZ007
        return timezone.make_aware(naive, _server_tz())

    if value.endswith("Z"):
        naive = dt.datetime.strptime(value, "%Y%m%dT%H%M%SZ")  # noqa: DTZ007
        return naive.replace(tzinfo=UTC)

    naive = dt.datetime.strptime(value, "%Y%m%dT%H%M%S")  # noqa: DTZ007
    tzid = params.get("TZID")
    if tzid:
        try:
            return naive.replace(tzinfo=ZoneInfo(tzid))
        except Exception:  # noqa: BLE001 — fall back to server tz on bad TZID
            logger.debug("Unknown TZID %r in iCalendar PUT; using server tz", tzid)
    return timezone.make_aware(naive, _server_tz())


def _unescape(value: str) -> str:
    out = []
    i = 0
    while i < len(value):
        ch = value[i]
        if ch == "\\" and i + 1 < len(value):
            nxt = value[i + 1]
            out.append({"n": "\n", "N": "\n"}.get(nxt, nxt))
            i += 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


class ParsedEvent:
    def __init__(self):
        self.uid: str | None = None
        self.dtstart: dt.datetime | None = None
        self.dtend: dt.datetime | None = None
        self.summary: str = ""
        self.description: str = ""


def _apply_field(event: ParsedEvent, line: str) -> None:
    """Parse a single content line into ``event`` (best-effort)."""
    if ":" not in line:
        return
    name_part, _, value = line.partition(":")
    name_bits = name_part.split(";")
    name = name_bits[0].upper()
    params = {}
    for bit in name_bits[1:]:
        if "=" in bit:
            key, _, val = bit.partition("=")
            params[key.upper()] = val

    if name == "UID":
        event.uid = value.strip()
    elif name == "DTSTART":
        event.dtstart = _parse_dt(value, params)
    elif name == "DTEND":
        event.dtend = _parse_dt(value, params)
    elif name == "SUMMARY":
        event.summary = _unescape(value)
    elif name == "DESCRIPTION":
        event.description = _unescape(value)


def parse_calendar(text: str) -> list[ParsedEvent]:
    """Parse VEVENTs out of an iCalendar document. Best-effort, lenient."""
    events: list[ParsedEvent] = []
    current: ParsedEvent | None = None
    for line in _unfold(text):
        if not line:
            continue
        if line == "BEGIN:VEVENT":
            current = ParsedEvent()
        elif line == "END:VEVENT":
            if current is not None:
                events.append(current)
            current = None
        elif current is not None:
            _apply_field(current, line)
    return events
