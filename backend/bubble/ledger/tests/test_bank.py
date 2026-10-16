"""Bank statement import: file sources, matching and decisions (plan section 12)."""

import datetime
from decimal import Decimal

import pytest
from constance.test import override_config
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status
from rest_framework.test import APIClient

from bubble.ledger.bank.camt import Camt053Source
from bubble.ledger.bank.csv_source import CsvSource, parse_amount
from bubble.ledger.bank.pipeline import (
    assign_line,
    book_line,
    ignore_line,
    import_file,
    link_line,
    park_line,
    reopen_line,
)
from bubble.ledger.bank.sources import StatementParseError
from bubble.ledger.exports import close_period
from bubble.ledger.intents import LEDGER_ADMIN_GROUP, IntentError
from bubble.ledger.models import (
    Category,
    KnownIban,
    LineState,
    MatchConfidence,
    StatementLine,
    TransactionKind,
)
from bubble.ledger.services import get_system_account

DAY = datetime.date(2025, 3, 3)
IBAN = "DE02120300000000202051"


def camt(*entries: str, version: str = "02") -> bytes:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.{version}">
  <BkToCstmrStmt><Stmt><Id>1</Id>{"".join(entries)}</Stmt></BkToCstmrStmt>
</Document>""".encode()


def entry(  # noqa: PLR0913
    amount="25.00",
    sign="CRDT",
    status_="<Sts>BOOK</Sts>",
    name="Bob Builder",
    iban=IBAN,
    text="BUB-XXXXXX",
    ref="REF-1",
    day="2025-03-03",
):
    role = "Dbtr" if sign == "CRDT" else "Cdtr"
    return f"""
<Ntry>
  <Amt Ccy="EUR">{amount}</Amt><CdtDbtInd>{sign}</CdtDbtInd>{status_}
  <BookgDt><Dt>{day}</Dt></BookgDt><ValDt><Dt>{day}</Dt></ValDt>
  <AcctSvcrRef>{ref}</AcctSvcrRef>
  <NtryDtls><TxDtls>
    <Refs><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
    <RltdPties><{role}><Nm>{name}</Nm></{role}>
      <{role}Acct><Id><IBAN>{iban}</IBAN></Id></{role}Acct></RltdPties>
    <RmtInf><Ustrd>{text}</Ustrd></RmtInf>
  </TxDtls></NtryDtls>
</Ntry>"""


SPARKASSE = (
    '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";'
    '"Verwendungszweck";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";'
    '"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"\n'
    '"DE00";"03.03.25";"03.03.25";"GUTSCHRIFT";"Guthaben {ref}";"Bob Müller";'
    '"DE02 1203 0000 0000 2020 51";"BYLADEM1";"1.025,50";"EUR";"Umsatz gebucht"\n'
    '"DE00";"04.03.25";"04.03.25";"LASTSCHRIFT";"Miete März";"Hausverwaltung";'
    '"DE11";"X";"-450,00";"EUR";"Umsatz gebucht"\n'
)


@pytest.fixture
def treasurer(members):
    group, _ = Group.objects.get_or_create(name=LEDGER_ADMIN_GROUP)
    user = members["dan"].owner
    user.groups.add(group)
    return user


def upload(content: bytes, name: str, user):
    return import_file(content, name, user=user)


def line_for(members, treasurer, **kwargs):
    """Import one CAMT line and return it."""
    kwargs.setdefault("text", "Thanks")
    result = upload(camt(entry(**kwargs)), "s.xml", treasurer)
    return result.statement.lines.get()


class TestCamt:
    def test_booked_entries_with_sign_and_other_party(self):
        content = camt(
            entry(text="BUB-ABCDEF top up"),
            entry(amount="10.00", sign="DBIT", name="Shop", ref="REF-2"),
            entry(status_="<Sts>PDNG</Sts>", ref="REF-3"),
            version="02",
        )
        incoming, outgoing = Camt053Source().read(content)
        assert (incoming.amount, incoming.counterparty_name) == (
            Decimal("25.00"),
            "Bob Builder",
        )
        assert incoming.counterparty_iban == IBAN
        assert incoming.reference == "BUB-ABCDEF top up"
        assert incoming.bank_reference == "REF-1"
        assert (outgoing.amount, outgoing.counterparty_name) == (Decimal(-10), "Shop")

    def test_newer_versions_nest_the_status_and_party(self):
        content = camt(
            entry(status_="<Sts><Cd>BOOK</Cd></Sts>").replace(
                "<Dbtr><Nm>Bob Builder</Nm></Dbtr>",
                "<Dbtr><Pty><Nm>Bob Builder</Nm></Pty></Dbtr>",
            ),
            version="08",
        )
        [line] = Camt053Source().read(content)
        assert line.counterparty_name == "Bob Builder"

    def test_a_batch_with_amounts_per_transaction_is_split(self):
        batch = """
<Ntry><Amt Ccy="EUR">30.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
  <BookgDt><Dt>2025-03-03</Dt></BookgDt><AcctSvcrRef>B1</AcctSvcrRef>
  <NtryDtls>
    <TxDtls><AmtDtls><TxAmt><Amt Ccy="EUR">10.00</Amt></TxAmt></AmtDtls>
      <RmtInf><Ustrd>one</Ustrd></RmtInf></TxDtls>
    <TxDtls><AmtDtls><TxAmt><Amt Ccy="EUR">20.00</Amt></TxAmt></AmtDtls>
      <RmtInf><Ustrd>two</Ustrd></RmtInf></TxDtls>
  </NtryDtls></Ntry>"""
        lines = Camt053Source().read(camt(batch))
        assert [(line.amount, line.reference) for line in lines] == [
            (Decimal(10), "one"),
            (Decimal(20), "two"),
        ]
        assert lines[0].bank_reference != lines[1].bank_reference

    @pytest.mark.parametrize(
        "content",
        [
            b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>',
            b"<Document><Other/></Document>",
            b"<Document><unclosed>",
        ],
        ids=["dtd", "not-a-statement", "broken"],
    )
    def test_rejects_what_is_not_a_statement(self, content):
        with pytest.raises(StatementParseError):
            Camt053Source().read(content)


class TestCsv:
    def test_sparkasse_export(self):
        content = SPARKASSE.format(ref="BUB-ABCDEF").encode("cp1252")
        incoming, rent = CsvSource().read(content)
        assert incoming.booked_on == DAY
        assert incoming.amount == Decimal("1025.50")
        assert incoming.counterparty_name == "Bob Müller"
        assert incoming.counterparty_iban == IBAN
        assert incoming.reference == "Guthaben BUB-ABCDEF"
        assert rent.amount == Decimal(-450)

    def test_english_export_after_a_preamble(self):
        content = (
            b"Account;My account\n\n"
            b"Date,Payee,Amount,Currency,Reference\n"
            b'2025-03-03,Bob,"1,234.50",EUR,hello\n'
            b"Closing balance,,,,\n"
        )
        [line] = CsvSource().read(content)
        assert (line.amount, line.reference) == (Decimal("1234.50"), "hello")

    def test_needs_date_and_amount_columns(self):
        with pytest.raises(StatementParseError):
            CsvSource().read(b"a;b\n1;2\n")

    def test_names_the_row_it_cannot_read(self):
        with pytest.raises(StatementParseError, match="3"):
            CsvSource().read(b"Datum;Betrag\n01.03.2025;1,00\n32.13.2025;2,00\n")

    @pytest.mark.parametrize(
        ("text", "value"),
        [
            ("1.234,56", "1234.56"),
            ("-12,50", "-12.50"),
            ("1,234.56", "1234.56"),
            ("12.50 €", "12.50"),
            ("+3", "3"),
        ],
    )
    def test_amounts(self, text, value):
        assert parse_amount(text) == Decimal(value)


class TestImport:
    def test_overlapping_files_do_not_duplicate_lines(self, treasurer):
        first = upload(camt(entry(ref="A"), entry(ref="B")), "jan.xml", treasurer)
        second = upload(camt(entry(ref="B"), entry(ref="C")), "feb.xml", treasurer)
        assert first.statement.new_line_count == 2  # noqa: PLR2004
        assert (second.statement.new_line_count, second.duplicates) == (1, 1)

    def test_identical_lines_on_the_same_day_are_both_kept(self, treasurer):
        csv = b"Datum;Betrag;Verwendungszweck\n03.03.2025;5,00;Kaffee\n" * 1
        csv += b"03.03.2025;5,00;Kaffee\n"
        result = upload(csv, "a.csv", treasurer)
        assert result.statement.new_line_count == 2  # noqa: PLR2004
        # The same two again (e.g. a longer export): nothing new.
        again = upload(csv + b"04.03.2025;1,00;x\n", "b.csv", treasurer)
        assert again.statement.new_line_count == 1

    def test_the_same_file_twice_is_refused(self, treasurer):
        upload(camt(entry()), "a.xml", treasurer)
        with pytest.raises(StatementParseError):
            upload(camt(entry()), "again.xml", treasurer)

    def test_only_the_treasurer(self, members):
        with pytest.raises(IntentError):
            upload(camt(entry()), "a.xml", members["bob"].owner)


class TestMatching:
    @pytest.mark.parametrize(
        "template",
        ["Guthaben {ref}", "guthaben {lower}", "{nodash} danke", "Top-up {split}"],
    )
    def test_payment_reference(self, members, treasurer, template):
        ref = members["bob"].payment_reference
        text = template.format(
            ref=ref,
            lower=ref.lower(),
            nodash=ref.replace("-", ""),
            split=f"{ref[:6]} {ref[6:]}",
        )
        line = line_for(members, treasurer, text=text, name="Someone")
        assert line.proposed_account == members["bob"]
        assert line.confidence == MatchConfidence.HIGH

    def test_known_iban(self, members, treasurer, book):
        KnownIban.objects.create(book=book, iban=IBAN, account=members["carla"])
        line = line_for(members, treasurer, name="C. Somebody")
        assert line.proposed_account == members["carla"]
        assert line.confidence == MatchConfidence.MEDIUM

    def test_similar_name(self, members, treasurer):
        line = line_for(members, treasurer, name="CARLA", iban="")
        assert line.proposed_account == members["carla"]
        assert line.confidence == MatchConfidence.LOW

    def test_nothing(self, members, treasurer):
        line = line_for(members, treasurer, name="Unknown GmbH", iban="")
        assert line.proposed_account is None
        assert line.confidence == MatchConfidence.NONE

    def test_a_hand_posted_top_up_is_proposed_for_linking(
        self, members, treasurer, post
    ):
        manual = post(
            ("asset:bank", 25),
            (members["bob"], -25),
            kind=TransactionKind.TOP_UP,
            occurred_on=DAY - datetime.timedelta(days=2),
        )
        line = line_for(
            members, treasurer, text=members["bob"].payment_reference, name="Bob"
        )
        assert line.proposed_transaction == manual
        assert line.proposed_account == members["bob"]


class TestDecisions:
    def test_booking_a_top_up(self, members, treasurer):
        line = line_for(members, treasurer)
        line = book_line(line, user=treasurer, account=members["bob"])

        assert line.state == LineState.BOOKED
        tx = line.transaction
        assert (tx.kind, tx.occurred_on) == (TransactionKind.TOP_UP, DAY)
        members["bob"].balance.refresh_from_db()
        assert members["bob"].display(members["bob"].balance.balance) == Decimal(25)
        # The IBAN is remembered for next time.
        assert KnownIban.objects.get(iban=IBAN).account == members["bob"]

    def test_a_payout_and_an_expense(self, members, treasurer, book):
        payout = line_for(members, treasurer, sign="DBIT", ref="P")
        payout = book_line(payout, user=treasurer, account=members["alice"])
        assert payout.transaction.kind == TransactionKind.PAYOUT
        members["alice"].balance.refresh_from_db()
        assert members["alice"].display(members["alice"].balance.balance) == -25  # noqa: PLR2004

        rent = line_for(members, treasurer, sign="DBIT", ref="R", amount="450.00")
        rent = book_line(
            rent,
            user=treasurer,
            category=Category.objects.get(book=book, code="rent"),
            description="March rent",
        )
        assert rent.transaction.kind == TransactionKind.EXPENSE
        assert rent.transaction.description == "March rent"

    def test_money_in_cannot_go_to_an_expense(self, members, treasurer, book):
        line = line_for(members, treasurer)
        with pytest.raises(IntentError):
            book_line(
                line,
                user=treasurer,
                category=Category.objects.get(book=book, code="rent"),
            )

    def test_a_line_is_booked_once(self, members, treasurer):
        line = line_for(members, treasurer)
        book_line(line, user=treasurer, account=members["bob"])
        with pytest.raises(IntentError):
            book_line(line, user=treasurer, account=members["carla"])

    def test_closed_period_books_today_and_says_so(self, members, treasurer, book):
        line = line_for(members, treasurer)
        close_period(book, DAY.replace(day=1), DAY, user=treasurer)
        line = book_line(line, user=treasurer, account=members["bob"])
        tx = line.transaction
        assert tx.occurred_on == datetime.date.today()  # noqa: DTZ011
        assert tx.meta["booked_by_bank_on"] == DAY.isoformat()
        assert "closed period" in tx.meta["note"]

    def test_link_to_what_was_posted_by_hand(self, members, treasurer, post):
        manual = post(
            ("asset:bank", 25),
            (members["bob"], -25),
            kind=TransactionKind.TOP_UP,
            occurred_on=DAY,
        )
        line = line_for(members, treasurer)
        line = link_line(line, manual, user=treasurer)
        assert (line.state, line.transaction) == (LineState.LINKED, manual)
        # Linking again from another line is refused.
        other = line_for(members, treasurer, ref="other")
        with pytest.raises(IntentError):
            link_line(other, manual, user=treasurer)
        # Linking can be undone; nothing was posted.
        line = reopen_line(line, user=treasurer)
        assert (line.state, line.transaction) == (LineState.OPEN, None)

    def test_park_and_assign_later(self, members, treasurer):
        suspense = get_system_account("suspense:unmatched")
        line = line_for(members, treasurer)

        line = park_line(line, user=treasurer, note="Who is this?")
        suspense.balance.refresh_from_db()
        assert suspense.balance.balance == -25  # noqa: PLR2004

        line = assign_line(line, user=treasurer, account=members["carla"])
        suspense.balance.refresh_from_db()
        assert suspense.balance.balance == 0
        assert line.state == LineState.BOOKED
        assert line.settlement.kind == TransactionKind.TOP_UP

    def test_ignore_needs_a_reason(self, members, treasurer):
        line = line_for(members, treasurer)
        with pytest.raises(IntentError):
            ignore_line(line, user=treasurer, note=" ")
        line = ignore_line(line, user=treasurer, note="Before the ledger started")
        assert line.state == LineState.IGNORED
        assert reopen_line(line, user=treasurer).state == LineState.OPEN

    def test_foreign_currency_cannot_be_booked(self, members, treasurer):
        line = line_for(members, treasurer)
        StatementLine.objects.filter(pk=line.pk).update(currency="CHF")
        line.refresh_from_db()
        with pytest.raises(IntentError):
            book_line(line, user=treasurer, account=members["bob"])
        with pytest.raises(IntentError):
            park_line(line, user=treasurer)

    @override_config(BANK_AUTO_CONFIRM_REFERENCES=True)
    def test_references_can_be_booked_on_import(self, members, treasurer):
        content = camt(
            entry(text=members["bob"].payment_reference, ref="1"),
            entry(text="no reference", name="Nobody", iban="", ref="2"),
        )
        result = upload(content, "s.xml", treasurer)
        assert result.booked == 1
        states = set(result.statement.lines.values_list("state", flat=True))
        assert states == {LineState.BOOKED, LineState.OPEN}


class TestApi:
    @pytest.fixture
    def client(self, treasurer):
        client = APIClient()
        client.force_authenticate(treasurer)
        return client

    def test_members_see_nothing_of_it(self, members):
        client = APIClient()
        client.force_authenticate(members["bob"].owner)
        assert (
            client.get("/api/ledger/bank/lines/").status_code
            == status.HTTP_403_FORBIDDEN
        )
        response = client.post(
            "/api/ledger/bank/imports/",
            {"file": SimpleUploadedFile("s.xml", camt(entry()))},
            format="multipart",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_upload_review_and_book(self, client, members):
        content = SPARKASSE.format(ref=members["bob"].payment_reference)
        response = client.post(
            "/api/ledger/bank/imports/",
            {"file": SimpleUploadedFile("umsaetze.csv", content.encode("cp1252"))},
            format="multipart",
        )
        assert response.status_code == status.HTTP_201_CREATED, response.data
        assert response.data["statement"]["new_line_count"] == 2  # noqa: PLR2004
        assert response.data["statement"]["open_count"] == 2  # noqa: PLR2004

        lines = client.get("/api/ledger/bank/lines/", {"state": "open"}).data
        top_up = next(r for r in lines["results"] if Decimal(r["amount"]) > 0)
        assert top_up["proposed_account"]["name"] == "Bob"
        assert top_up["confidence"] == "high"

        booked = client.post(
            f"/api/ledger/bank/lines/{top_up['id']}/book/",
            {"account": top_up["proposed_account"]["id"]},
            format="json",
        )
        assert booked.status_code == status.HTTP_200_OK, booked.data
        assert booked.data["state"] == "booked"
        assert booked.data["transaction"]["kind"] == "top_up"

        summary = client.get("/api/ledger/bank/lines/summary/").data
        assert (summary["open"], summary["booked"]) == (1, 1)
        assert Decimal(summary["bank_balance"]) == Decimal("1025.50")

    def test_errors_are_readable(self, client, members):
        response = client.post(
            "/api/ledger/bank/imports/",
            {"file": SimpleUploadedFile("x.csv", b"nothing;here\n")},
            format="multipart",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "file" in response.data

    def test_candidates_and_link(self, client, members, treasurer, post):
        manual = post(
            ("asset:bank", 25),
            (members["bob"], -25),
            kind=TransactionKind.TOP_UP,
            occurred_on=DAY,
        )
        line = line_for(members, treasurer)
        url = f"/api/ledger/bank/lines/{line.pk}/"
        candidates = client.get(url + "candidates/").data
        assert [c["id"] for c in candidates] == [str(manual.pk)]
        linked = client.post(
            url + "link/", {"transaction": str(manual.pk)}, format="json"
        )
        assert linked.data["state"] == "linked"

    @override_config(COMMUNITY_IBAN="DE02 1203 0000 0000 2020 51")
    def test_members_see_where_and_how_to_pay(self, members):
        client = APIClient()
        client.force_authenticate(members["bob"].owner)
        me = client.get("/api/ledger/accounts/me/").data
        assert me["payment_reference"] == members["bob"].payment_reference
        assert me["payment_reference"].startswith("BUB-")
        assert me["community_iban"] == "DE02 1203 0000 0000 2020 51"
