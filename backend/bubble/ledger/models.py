"""Double-entry, append-only ledger. See docs/ledger/plan.md.

Sign convention: every ``Entry.amount`` is signed and debit-positive, and the
entries of a transaction sum to exactly zero. ``Account.normal_side`` flips the
raw balance into the one a person expects to read (see section 3 of the plan).

Nothing outside ``bubble.ledger.services`` may create ``Transaction`` or
``Entry`` rows; both are immutable once written.
"""

import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from djmoney.models.fields import MoneyField
from simple_history.models import HistoricalRecords

from bubble.ledger.exceptions import ImmutableLedgerError
from config.settings.base import AUTH_USER_MODEL

ledger_money = {
    "max_digits": 12,
    "decimal_places": 2,
    "default_currency": settings.DEFAULT_CURRENCY,
}

DEFAULT_BOOK_SLUG = "default"


class BookManager(models.Manager):
    def default(self) -> "Book":
        """Return the single community book, creating it and its chart of accounts.

        Normally the data migration has already created it; creating it lazily
        keeps flushed test databases and fresh installs working.
        """
        from bubble.ledger.chart import ensure_chart_of_accounts  # noqa: PLC0415

        book, created = self.get_or_create(
            slug=DEFAULT_BOOK_SLUG,
            defaults={
                "name": "Community",
                "currency": settings.DEFAULT_CURRENCY,
                "opened_on": timezone.localdate(),
            },
        )
        if created:
            ensure_chart_of_accounts(book)
        return book


class Book(models.Model):
    """One community's set of accounts. A single row for now (plan D5)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=200)
    currency = models.CharField(max_length=3, default=settings.DEFAULT_CURRENCY)
    opened_on = models.DateField(default=timezone.localdate)
    negative_balance_soft_limit = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("-100.00"),
        help_text=_(
            "Members below this display balance get warnings and reminders. "
            "Nothing is blocked (plan D10)."
        ),
    )

    objects = BookManager()

    def __str__(self):
        return self.name


class AccountType(models.IntegerChoices):
    MEMBER = 1, _("Member")
    ASSET = 2, _("Asset")
    INCOME = 3, _("Income")
    EXPENSE = 4, _("Expense")
    EQUITY = 5, _("Equity")
    SUSPENSE = 6, _("Suspense")


class NormalSide(models.IntegerChoices):
    DEBIT = 1, _("Debit")
    CREDIT = -1, _("Credit")


NORMAL_SIDE_BY_TYPE = {
    AccountType.MEMBER: NormalSide.CREDIT,
    AccountType.ASSET: NormalSide.DEBIT,
    AccountType.INCOME: NormalSide.CREDIT,
    AccountType.EXPENSE: NormalSide.DEBIT,
    AccountType.EQUITY: NormalSide.CREDIT,
    AccountType.SUSPENSE: NormalSide.CREDIT,
}


class Account(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    book = models.ForeignKey(Book, on_delete=models.PROTECT, related_name="accounts")
    type = models.IntegerField(choices=AccountType)
    normal_side = models.IntegerField(choices=NormalSide, editable=False)
    code = models.CharField(
        max_length=100,
        help_text=_(
            "Stable, export-safe identifier, e.g. member:<uuid>, asset:bank, "
            "income:rental. Never changes once used."
        ),
    )
    name = models.CharField(max_length=255)
    owner = models.ForeignKey(
        AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ledger_accounts",
        help_text=_(
            "Only for member accounts. Cleared when the member leaves; the "
            "account and every entry on it stay."
        ),
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["book", "code"], name="ledger_account_code_per_book"
            ),
            models.UniqueConstraint(
                fields=["book", "owner"],
                condition=models.Q(owner__isnull=False),
                name="ledger_one_member_account_per_user",
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.code})"

    def save(self, *args, **kwargs):
        self.normal_side = NORMAL_SIDE_BY_TYPE[AccountType(self.type)]
        super().save(*args, **kwargs)

    def display(self, raw: Decimal) -> Decimal:
        """Flip a raw, debit-positive amount into this account's readable sign."""
        return raw * self.normal_side


class CategoryKind(models.TextChoices):
    INCOME = "income", _("Income")
    EXPENSE = "expense", _("Expense")
    TRANSFER = "transfer", _("Transfer")


class Category(models.Model):
    """What members pick when posting; income/expense ones map to an account."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    book = models.ForeignKey(Book, on_delete=models.PROTECT, related_name="categories")
    code = models.CharField(max_length=100)
    name = models.CharField(max_length=200)
    kind = models.CharField(max_length=20, choices=CategoryKind)
    account = models.ForeignKey(
        Account,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="categories",
        help_text=_("Income or expense account the category posts to."),
    )
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name_plural = _("categories")
        ordering = ["sort_order", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["book", "code"], name="ledger_category_code_per_book"
            ),
        ]

    def __str__(self):
        return self.name


class Project(models.Model):
    """A cost centre such as 'workshop' or 'summer festival' (plan D7)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    book = models.ForeignKey(Book, on_delete=models.PROTECT, related_name="projects")
    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=200)
    budget = MoneyField(**ledger_money, null=True, blank=True)
    starts_on = models.DateField(null=True, blank=True)
    ends_on = models.DateField(null=True, blank=True)
    is_archived = models.BooleanField(default=False)

    history = HistoricalRecords()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["book", "slug"], name="ledger_project_slug_per_book"
            ),
        ]

    def __str__(self):
        return self.name


class TransactionKind(models.IntegerChoices):
    BOOKING_CHARGE = 1, _("Booking charge")
    MEMBER_EXPENSE = 2, _("Member expense")
    SHARED_EXPENSE = 3, _("Shared expense")
    TOP_UP = 4, _("Top-up")
    PAYOUT = 5, _("Payout")
    MEMBERSHIP_FEE = 6, _("Membership fee")
    ADJUSTMENT = 7, _("Adjustment")
    OPENING_BALANCE = 8, _("Opening balance")
    REVERSAL = 9, _("Reversal")
    CORRECTION = 10, _("Correction")


TRANSACTION_SEQUENCE = "ledger_transaction_seq"


class ImmutableQuerySet(models.QuerySet):
    def update(self, **kwargs):
        msg = "Ledger rows cannot be updated."
        raise ImmutableLedgerError(msg)

    def delete(self):
        msg = "Ledger rows cannot be deleted."
        raise ImmutableLedgerError(msg)


class ImmutableModel(models.Model):
    """Rows are written once by the service layer and never changed.

    The database enforces the same rule with a trigger (migration 0001), so a
    raw SQL UPDATE or DELETE is refused as well.
    """

    objects = ImmutableQuerySet.as_manager()

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if not self._state.adding:
            msg = f"{type(self).__name__} rows are immutable."
            raise ImmutableLedgerError(msg)
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        msg = f"{type(self).__name__} rows are immutable."
        raise ImmutableLedgerError(msg)


class Transaction(ImmutableModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    book = models.ForeignKey(
        Book, on_delete=models.PROTECT, related_name="transactions"
    )
    # Stable global ordering, fed by a Postgres sequence created in migration
    # 0001. Not a BigAutoField, which Django only allows as the primary key.
    seq = models.BigIntegerField(
        editable=False,
        db_default=models.Func(models.Value(TRANSACTION_SEQUENCE), function="nextval"),
    )
    kind = models.IntegerField(choices=TransactionKind)
    occurred_on = models.DateField(help_text=_("Business date of the transaction."))
    created_at = models.DateTimeField(auto_now_add=True)
    # The author is referenced through their member account, not the user, so
    # a member leaving never has to touch an immutable row. Null means the
    # system posted it (e.g. a booking completing).
    created_by = models.ForeignKey(
        Account,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="authored_transactions",
    )
    description = models.TextField()
    category = models.ForeignKey(
        Category,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="transactions",
    )
    project = models.ForeignKey(
        Project,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="transactions",
    )
    source_type = models.CharField(max_length=50, blank=True)
    source_id = models.CharField(max_length=64, blank=True)
    idempotency_key = models.CharField(max_length=200, blank=True)
    meta = models.JSONField(default=dict, blank=True)
    reverses = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="reversed_by",
        help_text=_("Set on REVERSAL and CORRECTION transactions."),
    )

    class Meta:
        ordering = ["seq"]
        indexes = [
            models.Index(fields=["book", "occurred_on"]),
            models.Index(fields=["kind"]),
            models.Index(fields=["source_type", "source_id"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["book", "idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="ledger_transaction_idempotency_key_per_book",
            ),
            models.UniqueConstraint(
                fields=["book", "seq"], name="ledger_transaction_seq_per_book"
            ),
        ]

    def __str__(self):
        return f"#{self.seq} {self.get_kind_display()}: {self.description[:50]}"


class Entry(ImmutableModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    transaction = models.ForeignKey(
        Transaction, on_delete=models.PROTECT, related_name="entries"
    )
    account = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name="entries"
    )
    amount = MoneyField(**ledger_money, help_text=_("Signed, debit-positive."))
    # No database constraint: deleting an item must not rewrite ledger rows.
    # The id stays for per-item analytics even after the item is gone.
    item = models.ForeignKey(
        "items.Item",
        on_delete=models.DO_NOTHING,
        db_constraint=False,
        null=True,
        blank=True,
        related_name="+",
    )
    reverses_entry = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="reversed_by",
        help_text=_("For reversal legs: the original entry this undoes."),
    )
    memo = models.CharField(max_length=255, blank=True)

    class Meta:
        verbose_name_plural = _("entries")
        indexes = [
            models.Index(fields=["account", "transaction"]),
        ]

    def __str__(self):
        return f"{self.account.code} {self.amount}"


class AccountBalance(models.Model):
    """Cached raw balance, updated in the same DB transaction as every posting.

    The nightly ``verify_ledger`` task recomputes it from the entries.
    """

    account = models.OneToOneField(
        Account, on_delete=models.PROTECT, primary_key=True, related_name="balance"
    )
    balance = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal(0))
    entry_count = models.BigIntegerField(default=0)
    last_seq = models.BigIntegerField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.account.code}: {self.balance}"

    @property
    def display_balance(self) -> Decimal:
        return self.account.display(self.balance)


class LedgerPeriod(models.Model):
    """A closed period rejects postings dated inside it (invariant I6)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    book = models.ForeignKey(Book, on_delete=models.PROTECT, related_name="periods")
    starts_on = models.DateField()
    ends_on = models.DateField()
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(
        AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    export_hash = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ["starts_on"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(ends_on__gte=models.F("starts_on")),
                name="ledger_period_ends_after_start",
            ),
        ]

    def __str__(self):
        return f"{self.starts_on} to {self.ends_on}"
