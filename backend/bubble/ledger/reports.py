"""Statistics, statements and the annual report (plan D7, D12, section 13).

Everything here is read from ``Entry`` rows with plain aggregate queries; the
ledger is append-only, so nothing needs caching yet (plan section 8).

Two rules keep the figures honest:

* **Reversals net out.** A reversal or correction is a new transaction, but in
  statistics it counts *against* what it undoes: undoing a 50 € expense brings
  the expense total back down instead of adding 50 € of turnover.
* **Amounts read like the ledger.** ``income`` and ``expense`` are the effect on
  the community's income and expense accounts; ``amount`` is the money a
  transaction moved (the sum of its debit legs), which is what the feed shows.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

from django.db.models import Case, Count, F, Q, Sum, Value, When
from django.db.models.functions import Coalesce, TruncMonth
from django.utils.translation import gettext_lazy as _

from bubble.items.models import Item
from bubble.ledger.chart import DEFAULT_CATEGORY_NAMES
from bubble.ledger.models import (
    Account,
    AccountType,
    Book,
    Category,
    Entry,
    Project,
    TransactionKind,
)

if TYPE_CHECKING:
    from django.db.models import QuerySet

ZERO = Decimal("0.00")
CORRECTION_KINDS = (TransactionKind.REVERSAL, TransactionKind.CORRECTION)
GROUPS = ("category", "project", "month", "member", "item", "kind")

# An entry "goes the original way" unless it belongs to a reversal or
# correction; those count against what they undo.
_IS_UNDO = Q(transaction__kind__in=CORRECTION_KINDS)
_SIGN = Case(When(_IS_UNDO, then=Value(-1)), default=Value(1))
_DISPLAY = F("amount") * F("account__normal_side")
# A member leg that credits the member (raw < 0), or undoes a charge.
_CREDIT_LIKE = (Q(amount__lt=0) & ~_IS_UNDO) | (Q(amount__gt=0) & _IS_UNDO)


def _sum(expression, condition: Q | None = None):
    return Coalesce(Sum(expression, filter=condition), ZERO)


def _aggregates() -> dict:
    """The figures every statistics row carries."""
    member = Q(account__type=AccountType.MEMBER)
    return {
        "s_income": _sum(_DISPLAY, Q(account__type=AccountType.INCOME)),
        "s_expense": _sum(_DISPLAY, Q(account__type=AccountType.EXPENSE)),
        # The money a transaction moved is the sum of its debit legs (it is
        # balanced, so that equals its credit legs); an undo subtracts it.
        "s_amount": _sum(F("amount") * _SIGN, Q(amount__gt=0)),
        "s_credited": _sum(_DISPLAY, member & _CREDIT_LIKE),
        "s_charged": _sum(-1 * _DISPLAY, member & ~_CREDIT_LIKE),
        "s_count": Count("transaction", distinct=True, filter=~_IS_UNDO),
    }


@dataclass
class StatsRow:
    key: str | None
    label: str
    code: str = ""
    income: Decimal = ZERO
    expense: Decimal = ZERO
    amount: Decimal = ZERO
    credited: Decimal = ZERO
    charged: Decimal = ZERO
    count: int = 0
    budget: Decimal | None = None
    # The label is a seeded default the app may translate by ``code``.
    translatable: bool = False


@dataclass
class Stats:
    group_by: str
    currency: str
    date_from: date | None
    date_to: date | None
    totals: StatsRow
    rows: list[StatsRow] = field(default_factory=list)


def _entries(
    book: Book,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    category: Category | None = None,
    project: Project | None = None,
) -> QuerySet[Entry]:
    entries = Entry.objects.filter(transaction__book=book)
    if date_from:
        entries = entries.filter(transaction__occurred_on__gte=date_from)
    if date_to:
        entries = entries.filter(transaction__occurred_on__lte=date_to)
    if category:
        entries = entries.filter(transaction__category=category)
    if project:
        entries = entries.filter(transaction__project=project)
    return entries


def _row(values: dict, **extra) -> StatsRow:
    return StatsRow(
        income=values["s_income"],
        expense=values["s_expense"],
        amount=values["s_amount"],
        credited=values["s_credited"],
        charged=values["s_charged"],
        count=values["s_count"],
        **extra,
    )


def ledger_stats(  # noqa: PLR0913
    group_by: str,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    category: Category | None = None,
    project: Project | None = None,
    book: Book | None = None,
) -> Stats:
    """Totals for a period, and the same figures per category, project, month,
    member, item or transaction kind."""
    if group_by not in GROUPS:
        msg = f"Unknown grouping {group_by!r}."
        raise ValueError(msg)
    book = book or Book.objects.default()
    entries = _entries(
        book,
        date_from=date_from,
        date_to=date_to,
        category=category,
        project=project,
    )
    totals = _row(entries.aggregate(**_aggregates()), key=None, label="")
    rows = _GROUPERS[group_by](entries)
    return Stats(
        group_by=group_by,
        currency=book.currency,
        date_from=date_from,
        date_to=date_to,
        totals=totals,
        rows=rows,
    )


def _by(entries: QuerySet[Entry], key: str) -> list[dict]:
    return list(entries.values(key).annotate(**_aggregates()).order_by())


def _sorted(rows: list[StatsRow]) -> list[StatsRow]:
    return sorted(
        rows,
        key=lambda r: (-(abs(r.amount) + abs(r.income) + abs(r.expense)), r.label),
    )


def _by_category(entries: QuerySet[Entry]) -> list[StatsRow]:
    groups = _by(entries, "transaction__category")
    categories = Category.objects.in_bulk(
        [g["transaction__category"] for g in groups if g["transaction__category"]]
    )
    rows = []
    for g in groups:
        category = categories.get(g["transaction__category"])
        rows.append(
            _row(
                g,
                key=str(category.pk) if category else None,
                code=category.code if category else "",
                label=category.name if category else str(_("Uncategorised")),
                translatable=bool(category)
                and DEFAULT_CATEGORY_NAMES.get(category.code) == category.name,
            )
        )
    return _sorted(rows)


def _by_project(entries: QuerySet[Entry]) -> list[StatsRow]:
    groups = _by(entries, "transaction__project")
    projects = Project.objects.in_bulk(
        [g["transaction__project"] for g in groups if g["transaction__project"]]
    )
    rows = []
    for g in groups:
        project = projects.get(g["transaction__project"])
        rows.append(
            _row(
                g,
                key=str(project.pk) if project else None,
                code=project.slug if project else "",
                label=project.name if project else str(_("No project")),
                budget=project.budget.amount if project and project.budget else None,
            )
        )
    return _sorted(rows)


def _by_month(entries: QuerySet[Entry]) -> list[StatsRow]:
    groups = list(
        entries.annotate(month=TruncMonth("transaction__occurred_on"))
        .values("month")
        .annotate(**_aggregates())
        .order_by("month")
    )
    return [
        _row(g, key=g["month"].isoformat(), label=g["month"].strftime("%Y-%m"))
        for g in groups
    ]


def _by_member(entries: QuerySet[Entry]) -> list[StatsRow]:
    groups = _by(entries.filter(account__type=AccountType.MEMBER), "account")
    accounts = Account.objects.select_related("owner").in_bulk(
        [g["account"] for g in groups]
    )
    rows = []
    for g in groups:
        account = accounts[g["account"]]
        owner = account.owner
        rows.append(
            _row(
                g,
                key=str(account.pk),
                code=account.code,
                label=(owner.name or owner.username) if owner else account.name,
            )
        )
    return sorted(rows, key=lambda r: (-(r.credited + r.charged), r.label))


def _by_item(entries: QuerySet[Entry]) -> list[StatsRow]:
    groups = _by(entries.filter(item__isnull=False), "item")
    # The item may be gone by now; the entry keeps its id (plan D7).
    names = dict(
        Item._base_manager.filter(pk__in=[g["item"] for g in groups]).values_list(  # noqa: SLF001
            "pk", "name"
        )
    )
    rows = [
        _row(
            g,
            key=str(g["item"]),
            label=names.get(g["item"]) or str(_("Deleted item")),
        )
        for g in groups
    ]
    return _sorted(rows)


def _by_kind(entries: QuerySet[Entry]) -> list[StatsRow]:
    rows = [
        _row(
            g,
            key=TransactionKind(g["transaction__kind"]).name.lower(),
            code=TransactionKind(g["transaction__kind"]).name.lower(),
            label=str(TransactionKind(g["transaction__kind"]).label),
            translatable=True,
        )
        for g in _by(entries, "transaction__kind")
    ]
    return _sorted(rows)


_GROUPERS = {
    "category": _by_category,
    "project": _by_project,
    "month": _by_month,
    "member": _by_member,
    "item": _by_item,
    "kind": _by_kind,
}


# --- Statements -------------------------------------------------------------


@dataclass
class StatementLine:
    entry: Entry
    amount: Decimal
    balance_after: Decimal


@dataclass
class Statement:
    account: Account
    date_from: date
    date_to: date
    opening_balance: Decimal
    closing_balance: Decimal
    credited: Decimal
    charged: Decimal
    lines: list[StatementLine]


def account_statement(account: Account, date_from: date, date_to: date) -> Statement:
    """Every entry of an account in a period, by business date, with the balance
    before, after each line, and at the end (plan D12)."""
    opening_raw = Entry.objects.filter(
        account=account, transaction__occurred_on__lt=date_from
    ).aggregate(total=_sum("amount"))["total"]
    entries = (
        Entry.objects.filter(
            account=account,
            transaction__occurred_on__gte=date_from,
            transaction__occurred_on__lte=date_to,
        )
        .select_related("transaction")
        .order_by("transaction__occurred_on", "transaction__seq", "id")
    )
    balance = account.display(opening_raw)
    opening = balance
    credited = charged = ZERO
    lines = []
    for entry in entries:
        amount = account.display(entry.amount.amount)
        balance += amount
        if amount > 0:
            credited += amount
        else:
            charged -= amount
        lines.append(StatementLine(entry=entry, amount=amount, balance_after=balance))
    return Statement(
        account=account,
        date_from=date_from,
        date_to=date_to,
        opening_balance=opening,
        closing_balance=balance,
        credited=credited,
        charged=charged,
        lines=lines,
    )


# --- Annual report ----------------------------------------------------------


@dataclass
class AccountPosition:
    account: Account
    opening: Decimal
    closing: Decimal

    @property
    def change(self) -> Decimal:
        return self.closing - self.opening


@dataclass
class AnnualReport:
    year: int
    currency: str
    date_from: date
    date_to: date
    income: list[StatsRow]
    expense: list[StatsRow]
    total_income: Decimal
    total_expense: Decimal
    projects: list[StatsRow]
    members: list[AccountPosition]
    money: list[AccountPosition]
    other: list[AccountPosition]
    transactions: int
    trial_balance: Decimal

    @property
    def result(self) -> Decimal:
        return self.total_income - self.total_expense

    @property
    def owed_to_members(self) -> Decimal:
        return sum((p.closing for p in self.members if p.closing > 0), ZERO)

    @property
    def owed_by_members(self) -> Decimal:
        return -sum((p.closing for p in self.members if p.closing < 0), ZERO)

    @property
    def money_change(self) -> Decimal:
        return sum((p.change for p in self.money), ZERO)

    @property
    def explained_money_change(self) -> Decimal:
        """How the year explains the change in money: the result, plus what
        members and the other accounts gained or lost (double entry makes these
        add up exactly; the report shows the check)."""
        return (
            self.result
            + sum((p.change for p in self.members), ZERO)
            + sum((p.change for p in self.other), ZERO)
        )

    @property
    def reconciles(self) -> bool:
        return self.trial_balance == 0 and self.money_change == (
            self.explained_money_change
        )


def _positions(book: Book, types, date_from: date, date_to: date):
    before = Q(entries__transaction__occurred_on__lt=date_from)
    until = Q(entries__transaction__occurred_on__lte=date_to)
    accounts = (
        Account.objects.filter(book=book, type__in=types)
        .select_related("owner")
        .annotate(
            opening_raw=Coalesce(Sum("entries__amount", filter=before), ZERO),
            closing_raw=Coalesce(Sum("entries__amount", filter=until), ZERO),
        )
        .order_by("type", "code")
    )
    return [
        AccountPosition(
            account=a,
            opening=a.display(a.opening_raw),
            closing=a.display(a.closing_raw),
        )
        for a in accounts
        if a.opening_raw or a.closing_raw
    ]


def annual_report(year: int, book: Book | None = None) -> AnnualReport:
    """The treasurer's yearly overview (plan section 13): income and expense by
    category and project, what members are owed or owe at year end, where the
    money is, and the check that all of it adds up."""
    book = book or Book.objects.default()
    date_from, date_to = date(year, 1, 1), date(year, 12, 31)
    by_category = ledger_stats(
        "category", date_from=date_from, date_to=date_to, book=book
    )
    by_project = ledger_stats(
        "project", date_from=date_from, date_to=date_to, book=book
    )
    income = sorted((r for r in by_category.rows if r.income), key=lambda r: -r.income)
    expense = sorted(
        (r for r in by_category.rows if r.expense), key=lambda r: -r.expense
    )
    members = sorted(
        _positions(book, [AccountType.MEMBER], date_from, date_to),
        key=lambda p: (
            (p.account.owner.name or p.account.owner.username)
            if p.account.owner
            else p.account.name
        ).lower(),
    )
    trial = Entry.objects.filter(
        transaction__book=book, transaction__occurred_on__lte=date_to
    ).aggregate(total=_sum("amount"))["total"]
    return AnnualReport(
        year=year,
        currency=book.currency,
        date_from=date_from,
        date_to=date_to,
        income=income,
        expense=expense,
        total_income=by_category.totals.income,
        total_expense=by_category.totals.expense,
        projects=[r for r in by_project.rows if r.key is not None],
        members=members,
        money=_positions(book, [AccountType.ASSET], date_from, date_to),
        other=_positions(
            book, [AccountType.EQUITY, AccountType.SUSPENSE], date_from, date_to
        ),
        transactions=by_category.totals.count,
        trial_balance=trial,
    )
