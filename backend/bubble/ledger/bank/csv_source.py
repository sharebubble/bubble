"""CSV statement file source.

Every bank's CSV looks a little different. Columns are found by their header
(German or English names used by the common German and Austrian banks);
leading lines before the header row, ``;`` or ``,`` separators, German or
English number formats and UTF-8 or Windows-1252 files are all accepted.
"""

from __future__ import annotations

import csv
import io
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from django.utils.translation import gettext_lazy as _

from bubble.ledger.bank.sources import ParsedLine, StatementParseError, normalize_iban

# Column → header names, compared lower-case and without surrounding spaces.
COLUMNS: dict[str, tuple[str, ...]] = {
    "booked_on": (
        "buchungstag",
        "buchungsdatum",
        "buchung",
        "datum",
        "booking date",
        "date",
    ),
    "value_date": ("valutadatum", "valuta", "wertstellung", "value date"),
    "amount": (
        "betrag",
        "betrag (eur)",
        "betrag (€)",
        "umsatz",
        "umsatz in eur",
        "amount",
        "amount (eur)",
    ),
    "direction": ("soll/haben", "s/h", "debit/credit"),
    "currency": ("währung", "waehrung", "wkz", "currency"),
    "counterparty_name": (
        "beguenstigter/zahlungspflichtiger",
        "begünstigter/zahlungspflichtiger",
        "name zahlungsbeteiligter",
        "zahlungspflichtige*r",
        "zahlungsempfänger*in",
        "auftraggeber/empfänger",
        "auftraggeber / begünstigter",
        "empfänger/auftraggeber",
        "partnername",
        "counterparty",
        "payee",
        "name",
    ),
    "counterparty_iban": (
        "kontonummer/iban",
        "iban zahlungsbeteiligter",
        "iban auftraggeber/empfänger",
        "partner iban",
        "counterparty iban",
        "iban",
        "kontonummer",
    ),
    "reference": (
        "verwendungszweck",
        "buchungsdetails",
        "zahlungsreferenz",
        "purpose",
        "reference",
        "description",
    ),
    "end_to_end_id": (
        "kundenreferenz (end-to-end)",
        "end-to-end-referenz",
        "end-to-end reference",
        "end to end id",
    ),
}
REQUIRED = ("booked_on", "amount")
DATE_FORMATS = ("%d.%m.%Y", "%d.%m.%y", "%Y-%m-%d", "%d/%m/%Y")
HEADER_SEARCH_ROWS = 30
DELIMITERS = (";", ",", "\t")


def _decode(content: bytes) -> str:
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return content.decode("cp1252", errors="replace")


def _columns(header: list[str]) -> dict[str, int]:
    names = [h.strip().strip('"').strip().lower() for h in header]
    found = {}
    for column, aliases in COLUMNS.items():
        for alias in aliases:
            if alias in names and names.index(alias) not in found.values():
                found[column] = names.index(alias)
                break
    return found


def parse_amount(value: str) -> Decimal:
    """``1.234,56``, ``-12,50``, ``1,234.56``, ``12.50 €`` → Decimal."""
    cleaned = re.sub(r"[^\d,.\-+]", "", value)
    if "," in cleaned and "." in cleaned:
        decimal_mark = "," if cleaned.rfind(",") > cleaned.rfind(".") else "."
    else:
        decimal_mark = "," if "," in cleaned else "."
    thousands = "." if decimal_mark == "," else ","
    cleaned = cleaned.replace(thousands, "").replace(decimal_mark, ".")
    try:
        return Decimal(cleaned)
    except InvalidOperation as exc:
        raise ValueError(value) from exc


def parse_date(value: str) -> date:
    value = value.strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date()  # noqa: DTZ007
        except ValueError:
            continue
    raise ValueError(value)


class CsvSource:
    name = "csv"
    label = "CSV"

    def __init__(self, currency: str = "EUR"):
        self.currency = currency

    def read(self, content: bytes) -> list[ParsedLine]:
        text = _decode(content)
        # The separator is whichever one splits a row into a usable header.
        for delimiter in DELIMITERS:
            rows = list(csv.reader(io.StringIO(text), delimiter=delimiter))
            for index, row in enumerate(rows[:HEADER_SEARCH_ROWS]):
                columns = _columns(row)
                if all(c in columns for c in REQUIRED):
                    return self._lines(rows[index + 1 :], columns, index + 2)
        raise StatementParseError(
            _(
                "No booking date and amount columns found. The file needs a "
                "header row with e.g. “Buchungstag” and “Betrag”."
            )
        )

    def _lines(
        self, rows: list[list[str]], columns: dict[str, int], first_row: int
    ) -> list[ParsedLine]:
        lines = []
        for number, row in enumerate(rows, start=first_row):
            if not any(cell.strip() for cell in row):
                continue

            def cell(column: str, row=row) -> str:
                index = columns.get(column)
                return (
                    row[index].strip() if index is not None and index < len(row) else ""
                )

            try:
                amount = parse_amount(cell("amount"))
                booked_on = parse_date(cell("booked_on"))
                value_date = (
                    parse_date(cell("value_date")) if cell("value_date") else None
                )
            except ValueError:
                # Summary rows ("Kontostand", "Summe") at the end of some exports.
                if not cell("booked_on") or not cell("amount"):
                    continue
                raise StatementParseError(
                    _("Row %(row)d has a date or amount that cannot be read.")
                    % {"row": number}
                ) from None
            if cell("direction").upper() in {"S", "D", "DEBIT", "SOLL"}:
                amount = -abs(amount)
            lines.append(
                ParsedLine(
                    booked_on=booked_on,
                    value_date=value_date,
                    amount=amount,
                    currency=(cell("currency") or self.currency).upper()[:3],
                    counterparty_name=cell("counterparty_name")[:255],
                    counterparty_iban=normalize_iban(cell("counterparty_iban"))[:34],
                    reference=cell("reference"),
                    end_to_end_id=cell("end_to_end_id")[:100],
                    raw={"row": number, "cells": row},
                )
            )
        return lines
