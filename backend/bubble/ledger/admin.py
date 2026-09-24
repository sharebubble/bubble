"""Read-only admin for the ledger.

Posted rows are immutable, so the admin never offers add, change or delete for
them. Corrections are new transactions posted through the service layer.
"""

from django.contrib import admin
from simple_history.admin import SimpleHistoryAdmin

from bubble.ledger.models import (
    Account,
    AccountBalance,
    Book,
    Category,
    CostShare,
    CostShareParticipant,
    Dispute,
    Entry,
    KnownIban,
    LedgerDigest,
    LedgerPeriod,
    Project,
    Receipt,
    ReceiptAccess,
    StatementImport,
    StatementLine,
    Transaction,
    TransactionComment,
    TransactionSeal,
)


class ReadOnlyAdminMixin:
    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class NoDeleteAdminMixin:
    def has_delete_permission(self, request, obj=None):
        return False


class EntryInline(ReadOnlyAdminMixin, admin.TabularInline):
    model = Entry
    fk_name = "transaction"
    fields = ["account", "amount", "item_ref", "reverses_entry", "memo"]
    readonly_fields = fields
    extra = 0

    @admin.display(description="Item")
    def item_ref(self, obj):
        # The item may be deleted by now (no DB constraint on purpose), so
        # show the stored id instead of dereferencing it.
        return obj.item_id or "-"


@admin.register(Transaction)
class TransactionAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    list_display = [
        "seq",
        "occurred_on",
        "kind",
        "description",
        "category",
        "created_by",
    ]
    list_filter = ["kind", "category", "project"]
    search_fields = ["description", "idempotency_key", "source_id"]
    date_hierarchy = "occurred_on"
    inlines = [EntryInline]


@admin.register(Account)
class AccountAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    list_display = ["code", "name", "type", "owner", "is_active", "raw_balance"]
    list_filter = ["type", "is_active"]
    search_fields = ["code", "name"]
    list_select_related = ["balance", "owner"]

    @admin.display(description="Raw balance")
    def raw_balance(self, obj):
        return obj.balance.balance if hasattr(obj, "balance") else None


@admin.register(AccountBalance)
class AccountBalanceAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    list_display = ["account", "balance", "entry_count", "last_seq", "updated_at"]
    search_fields = ["account__code", "account__name"]


@admin.register(Book)
class BookAdmin(NoDeleteAdminMixin, admin.ModelAdmin):
    list_display = ["name", "slug", "currency", "opened_on"]
    readonly_fields = ["slug", "currency"]

    def has_add_permission(self, request):
        return False


@admin.register(Category)
class CategoryAdmin(NoDeleteAdminMixin, admin.ModelAdmin):
    list_display = ["name", "code", "kind", "account", "sort_order", "is_active"]
    list_filter = ["kind", "is_active"]


@admin.register(Project)
class ProjectAdmin(NoDeleteAdminMixin, SimpleHistoryAdmin):
    list_display = ["name", "slug", "budget", "starts_on", "ends_on", "is_archived"]
    list_filter = ["is_archived"]
    prepopulated_fields = {"slug": ["name"]}


@admin.register(LedgerPeriod)
class LedgerPeriodAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    list_display = ["starts_on", "ends_on", "closed_at", "closed_by"]


@admin.register(Receipt)
class ReceiptAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    list_display = [
        "file_name",
        "transaction",
        "cost_share",
        "uploaded_by",
        "uploaded_at",
        "size",
    ]
    # The file itself is downloaded through the logged API endpoint only.
    exclude = ["content"]
    readonly_fields = ["sha256"]
    search_fields = ["file_name", "sha256"]

    def get_queryset(self, request):
        return super().get_queryset(request).without_content()


@admin.register(ReceiptAccess)
class ReceiptAccessAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    list_display = ["receipt", "accessed_by", "accessed_at"]
    list_select_related = ["receipt", "accessed_by"]
    date_hierarchy = "accessed_at"


@admin.register(Dispute)
class DisputeAdmin(ReadOnlyAdminMixin, SimpleHistoryAdmin):
    """Disputes are answered in the app, where the answer is also posted."""

    list_display = ["transaction", "raised_by", "state", "created_at", "resolved_at"]
    list_filter = ["state"]
    list_select_related = ["transaction", "raised_by"]
    search_fields = ["reason", "resolution"]


@admin.register(TransactionComment)
class TransactionCommentAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    list_display = ["transaction", "author", "created_at"]
    list_select_related = ["transaction", "author"]
    search_fields = ["body"]


class CostShareParticipantInline(ReadOnlyAdminMixin, admin.TabularInline):
    model = CostShareParticipant
    fields = ["account", "weight", "amount", "guests", "response", "objection_reason"]
    readonly_fields = fields
    extra = 0


@admin.register(CostShare)
class CostShareAdmin(ReadOnlyAdminMixin, SimpleHistoryAdmin):
    """Splits change only through the app, so every participant is told."""

    list_display = [
        "description",
        "payer",
        "total",
        "state",
        "auto_accept_at",
        "created_at",
    ]
    list_filter = ["state", "split"]
    list_select_related = ["payer"]
    search_fields = ["description"]
    inlines = [CostShareParticipantInline]


@admin.register(TransactionSeal)
class TransactionSealAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    list_display = ["position", "transaction", "hash", "sealed_at"]
    search_fields = ["hash", "prev_hash"]


@admin.register(LedgerDigest)
class LedgerDigestAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    list_display = ["created_at", "position", "head_hash", "chain_ok", "published"]
    list_filter = ["chain_ok", "published"]


@admin.register(StatementImport)
class StatementImportAdmin(ReadOnlyAdminMixin, admin.ModelAdmin):
    list_display = ["imported_at", "file_name", "source", "line_count", "imported_by"]


@admin.register(StatementLine)
class StatementLineAdmin(ReadOnlyAdminMixin, SimpleHistoryAdmin):
    """Decisions on lines are made in the app, where they post to the ledger."""

    list_display = [
        "booked_on",
        "amount",
        "counterparty_name",
        "state",
        "confidence",
        "proposed_account",
    ]
    list_filter = ["state", "confidence"]
    search_fields = ["counterparty_name", "counterparty_iban", "reference"]
    date_hierarchy = "booked_on"


@admin.register(KnownIban)
class KnownIbanAdmin(admin.ModelAdmin):
    """IBANs learned from confirmed lines. Only a matching hint: deleting or
    reassigning a wrong one changes no booking."""

    list_display = ["iban", "account", "learned_at"]
    search_fields = ["iban", "account__name"]
    readonly_fields = ["book", "iban", "learned_at"]

    def has_add_permission(self, request, obj=None):
        return False
