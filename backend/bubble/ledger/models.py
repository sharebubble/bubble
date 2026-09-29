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
    payment_reference = models.CharField(
        max_length=20,
        blank=True,
        help_text=_(
            "Member accounts: the reference to put on bank transfers, so an "
            "imported statement line finds its member (plan section 12)."
        ),
    )
    datev_number = models.CharField(
        max_length=9,
        blank=True,
        help_text=_(
            "Account number in the tax advisor's chart (DATEV export). Member "
            "accounts may leave it empty to use the shared member account."
        ),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    soft_limit_reminded_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text=_(
            "Last reminder that the balance is below the soft limit (plan D10). "
            "Cleared when the balance recovers."
        ),
    )

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
            models.UniqueConstraint(
                fields=["book", "payment_reference"],
                condition=~models.Q(payment_reference=""),
                name="ledger_payment_reference_per_book",
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.code})"

    def save(self, *args, **kwargs):
        self.normal_side = NORMAL_SIDE_BY_TYPE[AccountType(self.type)]
        super().save(*args, **kwargs)

    def display(self, raw: Decimal) -> Decimal:
        """Flip a raw, debit-positive amount into this account's readable sign."""
        # abs() only matters for zero: -0.00 would otherwise leak into the UI.
        return (raw * self.normal_side) or abs(raw)


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
    MEMBER_TRANSFER = 11, _("Between members")
    INCOME = 12, _("Income")
    EXPENSE = 13, _("Expense")


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
    export_hash = models.CharField(
        max_length=64,
        blank=True,
        help_text=_("SHA-256 of the journal export of the period at closing."),
    )
    chain_position = models.BigIntegerField(null=True, blank=True)
    chain_head = models.CharField(
        max_length=64,
        blank=True,
        help_text=_("Head of the hash chain when the period was closed."),
    )
    transaction_count = models.PositiveIntegerField(default=0)

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


RECEIPT_MAX_BYTES = 10 * 1024 * 1024


class ReceiptQuerySet(ImmutableQuerySet):
    def without_content(self):
        return self.defer("content")


class Receipt(ImmutableModel):
    """A scanned receipt attached to a transaction (plan section 7, D8).

    The file lives in the database rather than on media storage: it is
    private on every deployment without extra configuration (media is served
    publicly), it is backed up together with the books it documents, and the
    append-only trigger protects it like the rows it belongs to. Receipts are
    only ever added, never replaced; the SHA-256 is shown next to them.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    transaction = models.ForeignKey(
        Transaction,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="receipts",
    )
    # A shared expense collects its receipts before it is booked; receipts are
    # append-only, so they stay attached to the cost share afterwards.
    cost_share = models.ForeignKey(
        "CostShare",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="receipts",
    )
    uploaded_by = models.ForeignKey(
        Account,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="uploaded_receipts",
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)
    file_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    size = models.PositiveIntegerField()
    sha256 = models.CharField(max_length=64)
    content = models.BinaryField()

    objects = ReceiptQuerySet.as_manager()

    class Meta:
        ordering = ["uploaded_at"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(transaction__isnull=False, cost_share__isnull=True)
                    | models.Q(transaction__isnull=True, cost_share__isnull=False)
                ),
                name="ledger_receipt_belongs_to_one_thing",
            ),
        ]

    def __str__(self):
        return f"{self.file_name} ({self.sha256[:12]})"


class ReceiptAccess(ImmutableModel):
    """One row per receipt download: who looked at which receipt, and when."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    receipt = models.ForeignKey(
        Receipt, on_delete=models.PROTECT, related_name="accesses"
    )
    accessed_by = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name="receipt_accesses"
    )
    accessed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = _("receipt accesses")
        ordering = ["-accessed_at"]

    def __str__(self):
        return f"{self.accessed_by} read {self.receipt} at {self.accessed_at}"


class DisputeState(models.TextChoices):
    OPEN = "open", _("Open")
    WITHDRAWN = "withdrawn", _("Withdrawn")
    REVERSED = "reversed", _("Resolved by a reversal")
    CORRECTED = "corrected", _("Resolved by a correction")
    UPHELD = "upheld", _("Kept as it is")


class Dispute(models.Model):
    """A member flags a transaction as wrong (plan D9).

    The transaction itself is never touched: the author or the treasurer
    answers with a reversal or correction, or keeps it with an explanation.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    transaction = models.ForeignKey(
        Transaction, on_delete=models.PROTECT, related_name="disputes"
    )
    raised_by = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name="raised_disputes"
    )
    reason = models.TextField()
    state = models.CharField(
        max_length=20, choices=DisputeState, default=DisputeState.OPEN
    )
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        Account,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="resolved_disputes",
    )
    resolution = models.TextField(blank=True)

    history = HistoricalRecords()

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["transaction", "raised_by"],
                condition=models.Q(state="open"),
                name="ledger_one_open_dispute_per_member",
            ),
        ]

    def __str__(self):
        return f"Dispute of #{self.transaction.seq} ({self.get_state_display()})"


class TransactionComment(ImmutableModel):
    """The discussion under a transaction. Comments are never edited."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    transaction = models.ForeignKey(
        Transaction, on_delete=models.PROTECT, related_name="comments"
    )
    author = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name="transaction_comments"
    )
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"Comment on #{self.transaction.seq} by {self.author}"


class CostShareSplit(models.TextChoices):
    EQUAL = "equal", _("Equal shares")
    WEIGHTS = "weights", _("Weighted shares")
    AMOUNTS = "amounts", _("Fixed amounts")


class CostShareState(models.TextChoices):
    OPEN = "open", _("Waiting for answers")
    POSTED = "posted", _("Booked")
    CANCELLED = "cancelled", _("Cancelled")


class CostShare(models.Model):
    """A shared expense waiting for its participants (plan section 7a, D13).

    It lives outside the append-only ledger until everyone answered or the
    deadline passed; then it posts one SHARED_EXPENSE transaction.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    book = models.ForeignKey(Book, on_delete=models.PROTECT, related_name="cost_shares")
    payer = models.ForeignKey(
        Account,
        on_delete=models.PROTECT,
        related_name="paid_cost_shares",
        help_text=_("Who paid, and is credited the other participants' shares."),
    )
    description = models.TextField()
    occurred_on = models.DateField()
    total = MoneyField(**ledger_money)
    category = models.ForeignKey(
        Category,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="cost_shares",
    )
    project = models.ForeignKey(
        Project,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="cost_shares",
    )
    split = models.CharField(
        max_length=20, choices=CostShareSplit, default=CostShareSplit.EQUAL
    )
    payer_participates = models.BooleanField(default=True)
    payer_weight = models.DecimalField(
        max_digits=6, decimal_places=2, default=Decimal(1)
    )
    payer_guests = models.PositiveSmallIntegerField(default=0)
    auto_accept_at = models.DateTimeField()
    state = models.CharField(
        max_length=20, choices=CostShareState, default=CostShareState.OPEN
    )
    posted_transaction = models.OneToOneField(
        Transaction,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="cost_share",
    )
    cancelled_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    history = HistoricalRecords()

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.description[:50]} ({self.total})"


class ParticipantResponse(models.TextChoices):
    PENDING = "pending", _("Waiting")
    ACCEPTED = "accepted", _("Accepted")
    OBJECTED = "objected", _("Objected")


class CostShareParticipant(models.Model):
    """One member charged part of a shared expense, and their answer."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cost_share = models.ForeignKey(
        CostShare, on_delete=models.CASCADE, related_name="participants"
    )
    account = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name="cost_share_participations"
    )
    weight = models.DecimalField(max_digits=6, decimal_places=2, default=Decimal(1))
    amount = MoneyField(
        **ledger_money,
        null=True,
        blank=True,
        help_text=_("For fixed-amount splits: this participant's amount."),
    )
    guests = models.PositiveSmallIntegerField(
        default=0,
        help_text=_("Non-members this participant brought; they pay for them."),
    )
    response = models.CharField(
        max_length=20, choices=ParticipantResponse, default=ParticipantResponse.PENDING
    )
    responded_at = models.DateTimeField(null=True, blank=True)
    objection_reason = models.TextField(blank=True)
    reminded_at = models.DateTimeField(null=True, blank=True)

    history = HistoricalRecords()

    class Meta:
        ordering = ["account__name"]
        constraints = [
            models.UniqueConstraint(
                fields=["cost_share", "account"],
                name="ledger_one_participation_per_member",
            ),
        ]

    def __str__(self):
        return f"{self.account} in {self.cost_share}"


class TransactionSeal(ImmutableModel):
    """One link of the hash chain (plan section 11, phase 6).

    ``hash = sha256(prev_hash + canonical transaction)``, written in the same
    database transaction as the posting. Anyone who kept an earlier head hash
    (the daily digest) can detect a later edit anywhere before it, even one
    made directly in the database.
    """

    transaction = models.OneToOneField(
        Transaction, on_delete=models.PROTECT, primary_key=True, related_name="seal"
    )
    book = models.ForeignKey(Book, on_delete=models.PROTECT, related_name="seals")
    position = models.BigIntegerField(help_text=_("1 for the first transaction."))
    prev_hash = models.CharField(max_length=64)
    hash = models.CharField(max_length=64)
    sealed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(
                fields=["book", "position"], name="ledger_seal_position_per_book"
            ),
            models.UniqueConstraint(
                fields=["book", "prev_hash"], name="ledger_seal_no_fork"
            ),
        ]

    def __str__(self):
        return f"#{self.position} {self.hash[:12]}"


class LedgerDigest(ImmutableModel):
    """The chain head as it was at one moment, published outside the app."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    book = models.ForeignKey(Book, on_delete=models.PROTECT, related_name="digests")
    created_at = models.DateTimeField(auto_now_add=True)
    position = models.BigIntegerField()
    head_hash = models.CharField(max_length=64)
    transaction_count = models.BigIntegerField()
    chain_ok = models.BooleanField(
        help_text=_("The whole chain was recomputed and matched when this was made.")
    )
    published = models.BooleanField(
        default=False, help_text=_("Sent to the configured digest channel.")
    )

    class Meta:
        ordering = ["-created_at"]
        get_latest_by = "created_at"

    def __str__(self):
        return f"{self.created_at:%Y-%m-%d} #{self.position} {self.head_hash[:12]}"


# --- Bank import (plan section 12, D11) ----------------------------------------


class StatementImport(models.Model):
    """One uploaded bank statement file (or one pull from a bank adapter)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    book = models.ForeignKey(Book, on_delete=models.PROTECT, related_name="imports")
    source = models.CharField(max_length=20, help_text=_("Adapter, e.g. camt053."))
    file_name = models.CharField(max_length=255, blank=True)
    sha256 = models.CharField(max_length=64)
    imported_at = models.DateTimeField(auto_now_add=True)
    imported_by = models.ForeignKey(
        Account, on_delete=models.PROTECT, null=True, related_name="+"
    )
    line_count = models.PositiveIntegerField(default=0)
    new_line_count = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-imported_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["book", "sha256"], name="ledger_import_once_per_file"
            ),
        ]

    def __str__(self):
        return f"{self.file_name or self.source} ({self.imported_at:%Y-%m-%d})"


class LineState(models.TextChoices):
    OPEN = "open", _("To review")
    BOOKED = "booked", _("Booked")
    LINKED = "linked", _("Matched to an entry")
    SUSPENSE = "suspense", _("Parked, to be clarified")
    IGNORED = "ignored", _("Ignored")


class MatchConfidence(models.TextChoices):
    HIGH = "high", _("Payment reference")
    MEDIUM = "medium", _("Known account")
    LOW = "low", _("Similar name")
    NONE = "none", _("No match")


class StatementLine(models.Model):
    """One booked movement on the community's bank account.

    Positive amounts came in, negative ones went out. A line is booked as a
    top-up or payout, linked to an entry someone already posted by hand,
    parked in ``suspense:unmatched`` until it is clarified, or ignored.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    book = models.ForeignKey(Book, on_delete=models.PROTECT, related_name="bank_lines")
    statement = models.ForeignKey(
        StatementImport, on_delete=models.PROTECT, related_name="lines"
    )
    fingerprint = models.CharField(
        max_length=64, help_text=_("Recognises the same line in overlapping files.")
    )
    booked_on = models.DateField()
    value_date = models.DateField(null=True, blank=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3)
    counterparty_name = models.CharField(max_length=255, blank=True)
    counterparty_iban = models.CharField(max_length=34, blank=True)
    reference = models.TextField(blank=True)
    end_to_end_id = models.CharField(max_length=100, blank=True)
    raw = models.JSONField(default=dict, blank=True)

    state = models.CharField(max_length=20, choices=LineState, default=LineState.OPEN)
    proposed_account = models.ForeignKey(
        Account, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    proposed_transaction = models.ForeignKey(
        "Transaction",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
        help_text=_("An entry already posted by hand that this line pays for."),
    )
    confidence = models.CharField(
        max_length=10, choices=MatchConfidence, default=MatchConfidence.NONE
    )
    reason = models.CharField(max_length=255, blank=True)

    transaction = models.ForeignKey(
        "Transaction",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="bank_lines",
        help_text=_("The entry that booked or matched this line."),
    )
    settlement = models.ForeignKey(
        "Transaction",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
        help_text=_("The entry that moved a parked line out of suspense."),
    )
    resolved_by = models.ForeignKey(
        Account, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    note = models.TextField(blank=True)

    history = HistoricalRecords()

    class Meta:
        ordering = ["-booked_on", "-amount"]
        constraints = [
            models.UniqueConstraint(
                fields=["book", "fingerprint"], name="ledger_bank_line_once"
            ),
            models.UniqueConstraint(
                fields=["transaction"],
                condition=models.Q(transaction__isnull=False),
                name="ledger_bank_line_one_per_transaction",
            ),
        ]
        indexes = [models.Index(fields=["book", "state"])]

    def __str__(self):
        return f"{self.booked_on} {self.amount} {self.counterparty_name}"


class KnownIban(models.Model):
    """An IBAN a member has paid from before (medium-confidence matching)."""

    book = models.ForeignKey(Book, on_delete=models.PROTECT, related_name="+")
    iban = models.CharField(max_length=34)
    account = models.ForeignKey(
        Account, on_delete=models.CASCADE, related_name="known_ibans"
    )
    learned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["book", "iban"], name="ledger_iban_once"),
        ]

    def __str__(self):
        return f"{self.iban} → {self.account}"
