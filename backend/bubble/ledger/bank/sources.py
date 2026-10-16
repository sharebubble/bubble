"""Where bank statement lines come from (plan section 12, D11).

The pipeline only sees ``ParsedLine`` objects. Which bank interface the
community will use is still open (D11), so the only sources today read files
the treasurer downloads from online banking: CAMT.053 (XML) and CSV. A later
PSD2 or FinTS/EBICS adapter produces the same ``ParsedLine`` objects and hands
them to ``bubble.ledger.bank.pipeline.ingest``; nothing else changes.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Protocol

from django.utils.translation import gettext_lazy as _

from bubble.ledger.intents import IntentError

if TYPE_CHECKING:
    from datetime import date
    from decimal import Decimal


class StatementParseError(IntentError):
    """The file is not a statement this source can read; the message is shown."""

    def __init__(self, message):
        super().__init__(message, field="file")


@dataclass
class ParsedLine:
    """One booked movement, as the bank reports it. Positive amounts came in."""

    booked_on: date
    amount: Decimal
    currency: str
    value_date: date | None = None
    counterparty_name: str = ""
    counterparty_iban: str = ""
    reference: str = ""
    end_to_end_id: str = ""
    # The bank's own unique id for the movement, when it gives one.
    bank_reference: str = ""
    raw: dict = field(default_factory=dict)

    def identity(self) -> str:
        """What makes two lines the same movement, as far as the data can tell."""
        if self.bank_reference:
            return f"bank:{self.bank_reference}"
        parts = [
            self.booked_on.isoformat(),
            f"{self.amount:.2f}",
            self.currency,
            self.counterparty_iban,
            self.counterparty_name,
            self.reference,
        ]
        if self.end_to_end_id and self.end_to_end_id.upper() != "NOTPROVIDED":
            parts.append(self.end_to_end_id)
        return "fields:" + "|".join(parts)


def fingerprints(lines: list[ParsedLine]) -> list[str]:
    """Stable ids for deduplication across overlapping files.

    Two genuinely identical movements on the same day (same amount, payer and
    text) are told apart by their order in the file, which banks keep stable.
    """
    seen: dict[str, int] = {}
    result = []
    for line in lines:
        identity = line.identity()
        seen[identity] = seen.get(identity, 0) + 1
        digest = hashlib.sha256(f"{identity}#{seen[identity]}".encode()).hexdigest()
        result.append(digest)
    return result


class BankStatementSource(Protocol):
    """A way to get statement lines into the ledger.

    File sources implement ``read``. A pulling adapter (PSD2, FinTS/EBICS),
    once D11 is decided, fetches lines on a schedule and passes them to
    ``pipeline.ingest`` with its own ``name``.
    """

    name: str
    label: str

    def read(self, content: bytes) -> list[ParsedLine]: ...


def normalize_iban(value: str) -> str:
    return "".join(value.split()).upper()


def file_source(content: bytes, file_name: str = "") -> BankStatementSource:
    """Pick the file source by looking at the content."""
    from bubble.ledger.bank.camt import Camt053Source  # noqa: PLC0415
    from bubble.ledger.bank.csv_source import CsvSource  # noqa: PLC0415

    start = content.lstrip(b"\xef\xbb\xbf \t\r\n")[:1]
    if start == b"<" or file_name.lower().endswith(".xml"):
        return Camt053Source()
    if file_name.lower().endswith((".sta", ".mt940", ".940")):
        raise StatementParseError(
            _(
                "MT940 files are not supported. Download the statement as "
                "CAMT.053 (XML) or CSV instead."
            )
        )
    return CsvSource()
