"""CAMT.053 (ISO 20022 bank-to-customer statement) file source.

Reads every version German banks hand out (``camt.053.001.02`` to ``.08``):
namespaces are ignored and only elements common to all versions are used.
One line per booked entry, or one per transaction when a batch entry lists its
transactions with their own amounts.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import TYPE_CHECKING

from django.utils.translation import gettext_lazy as _

from bubble.ledger.bank.sources import ParsedLine, StatementParseError, normalize_iban

if TYPE_CHECKING:
    from collections.abc import Iterator

# Statements never need a DTD; refusing them rules out entity expansion.
_FORBIDDEN = re.compile(rb"<!(DOCTYPE|ENTITY)", re.IGNORECASE)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _children(element: ET.Element, name: str) -> Iterator[ET.Element]:
    return (child for child in element if _local(child.tag) == name)


def _find(element: ET.Element | None, path: str) -> ET.Element | None:
    """First element along ``A/B/C`` by local names, or None."""
    for name in path.split("/"):
        if element is None:
            return None
        element = next(_children(element, name), None)
    return element


def _text(element: ET.Element | None, path: str) -> str:
    found = _find(element, path)
    return (found.text or "").strip() if found is not None else ""


def _date(element: ET.Element | None, path: str) -> date | None:
    found = _find(element, path)
    if found is None:
        return None
    value = _text(found, "Dt") or _text(found, "DtTm")[:10]
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        return None


def _amount(element: ET.Element | None) -> tuple[Decimal, str] | None:
    if element is None or not (element.text or "").strip():
        return None
    try:
        return Decimal(element.text.strip()), element.get("Ccy", "")
    except InvalidOperation:
        return None


def _status(entry: ET.Element) -> str:
    # <Sts>BOOK</Sts> up to version 05, <Sts><Cd>BOOK</Cd></Sts> after.
    return _text(entry, "Sts/Cd") or _text(entry, "Sts")


def _party(details: ET.Element | None, role: str) -> tuple[str, str]:
    parties = _find(details, "RltdPties")
    name = _text(parties, f"{role}/Nm") or _text(parties, f"{role}/Pty/Nm")
    iban = _text(parties, f"{role}Acct/Id/IBAN")
    return name, normalize_iban(iban)


def _reference(details: ET.Element | None, entry: ET.Element) -> str:
    remittance = _find(details, "RmtInf")
    parts = []
    if remittance is not None:
        parts.extend(
            (u.text or "").strip() for u in _children(remittance, "Ustrd") if u.text
        )
        for structured in _children(remittance, "Strd"):
            ref = _text(structured, "CdtrRefInf/Ref")
            if ref:
                parts.append(ref)
    if not parts:
        parts.append(_text(entry, "AddtlNtryInf"))
    return " ".join(p for p in parts if p)


class Camt053Source:
    name = "camt053"
    label = "CAMT.053"

    def read(self, content: bytes) -> list[ParsedLine]:
        if _FORBIDDEN.search(content[:4096]):
            raise StatementParseError(_("This XML file is not a bank statement."))
        try:
            root = ET.fromstring(content)  # noqa: S314 - no DTDs, see above
        except ET.ParseError as exc:
            raise StatementParseError(
                _("This file is not valid XML: %(error)s") % {"error": exc}
            ) from exc
        statements = [
            element for element in root.iter() if _local(element.tag) == "Stmt"
        ]
        if not statements:
            raise StatementParseError(
                _("This XML file is not a CAMT.053 bank statement.")
            )
        lines: list[ParsedLine] = []
        for statement in statements:
            for entry in _children(statement, "Ntry"):
                if _status(entry) == "BOOK":
                    lines.extend(self._entry_lines(entry))
        return lines

    def _entry_lines(self, entry: ET.Element) -> list[ParsedLine]:
        amount = _amount(_find(entry, "Amt"))
        booked_on = _date(entry, "BookgDt")
        if amount is None or booked_on is None:
            raise StatementParseError(
                _("A booked entry has no amount or booking date.")
            )
        sign = -1 if _text(entry, "CdtDbtInd") == "DBIT" else 1
        details = [
            d
            for batch in _children(entry, "NtryDtls")
            for d in _children(batch, "TxDtls")
        ]
        # A batch with its own amounts per transaction becomes several lines.
        own_amounts = [
            _amount(_find(d, "AmtDtls/TxAmt/Amt")) or _amount(_find(d, "Amt"))
            for d in details
        ]
        if len(details) > 1 and all(own_amounts):
            return [
                self._line(entry, d, booked_on, a, sign, index)
                for index, (d, a) in enumerate(zip(details, own_amounts, strict=True))
            ]
        return [
            self._line(
                entry, details[0] if details else None, booked_on, amount, sign, 0
            )
        ]

    def _line(  # noqa: PLR0913
        self,
        entry: ET.Element,
        details: ET.Element | None,
        booked_on: date,
        amount: tuple[Decimal, str],
        sign: int,
        index: int,
    ) -> ParsedLine:
        value, currency = amount
        # The other side: who paid us, or whom we paid.
        role = "Cdtr" if sign < 0 else "Dbtr"
        name, iban = _party(details, role)
        bank_reference = _text(details, "Refs/AcctSvcrRef") or _text(
            entry, "AcctSvcrRef"
        )
        if bank_reference and index and not _text(details, "Refs/AcctSvcrRef"):
            bank_reference = f"{bank_reference}/{index}"
        return ParsedLine(
            booked_on=booked_on,
            value_date=_date(entry, "ValDt"),
            amount=sign * value,
            currency=currency,
            counterparty_name=name[:255],
            counterparty_iban=iban[:34],
            reference=_reference(details, entry),
            end_to_end_id=_text(details, "Refs/EndToEndId")[:100],
            bank_reference=bank_reference,
            raw={
                "entry_reference": _text(entry, "NtryRef"),
                "bank_reference": bank_reference,
                "transaction_code": _text(entry, "BkTxCd/Prtry/Cd")
                or _text(entry, "BkTxCd/Domn/Fmly/SubFmlyCd"),
                "additional_info": _text(entry, "AddtlNtryInf"),
            },
        )
