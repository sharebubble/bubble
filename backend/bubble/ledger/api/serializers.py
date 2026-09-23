"""Read and write shapes of the ledger API (plan section 9).

Amounts are decimal strings in the book currency. ``amount`` on an entry is the
raw, debit-positive value; ``display_amount`` is its effect on the balance a
person reads for that account (for a member: positive means the community owes
them more).
"""

from decimal import Decimal

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from bubble.ledger.cost_shares import compute_shares
from bubble.ledger.disputes import can_reverse
from bubble.ledger.intents import Intent, Via
from bubble.ledger.models import (
    Account,
    AccountType,
    Category,
    CostShare,
    CostShareParticipant,
    CostShareSplit,
    Dispute,
    Entry,
    ParticipantResponse,
    Project,
    Receipt,
    Transaction,
    TransactionComment,
    TransactionKind,
)
from bubble.ledger.services import reversible_amounts

ACCOUNT_TYPES = [t.name.lower() for t in AccountType]
TRANSACTION_KINDS = [k.name.lower() for k in TransactionKind]
MONEY = {"max_digits": 14, "decimal_places": 2}


def account_name(account: Account) -> str:
    """Member accounts follow the member's current name; others keep theirs."""
    owner = account.owner
    if owner is not None:
        return owner.name or owner.username
    return account.name


class LedgerAccountRefSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    type = serializers.SerializerMethodField()
    owner_username = serializers.CharField(
        source="owner.username", read_only=True, allow_null=True, default=None
    )

    class Meta:
        model = Account
        fields = ["id", "code", "name", "type", "owner", "owner_username", "is_active"]
        read_only_fields = fields

    def get_name(self, obj) -> str:
        return account_name(obj)

    @extend_schema_field(serializers.ChoiceField(choices=ACCOUNT_TYPES))
    def get_type(self, obj) -> str:
        return AccountType(obj.type).name.lower()


class LedgerAccountSerializer(LedgerAccountRefSerializer):
    balance = serializers.SerializerMethodField()
    entry_count = serializers.SerializerMethodField()
    currency = serializers.CharField(source="book.currency", read_only=True)

    class Meta(LedgerAccountRefSerializer.Meta):
        fields = [
            *LedgerAccountRefSerializer.Meta.fields,
            "balance",
            "entry_count",
            "currency",
        ]
        read_only_fields = fields

    @extend_schema_field(serializers.DecimalField(**MONEY))
    def get_balance(self, obj) -> str:
        balance = getattr(obj, "balance", None)
        raw = balance.balance if balance is not None else Decimal(0)
        return f"{obj.display(raw):.2f}"

    def get_entry_count(self, obj) -> int:
        balance = getattr(obj, "balance", None)
        return balance.entry_count if balance is not None else 0


class LedgerMyAccountSerializer(LedgerAccountSerializer):
    soft_limit = serializers.DecimalField(
        source="book.negative_balance_soft_limit", read_only=True, **MONEY
    )
    below_soft_limit = serializers.SerializerMethodField()
    is_ledger_admin = serializers.SerializerMethodField()

    class Meta(LedgerAccountSerializer.Meta):
        fields = [
            *LedgerAccountSerializer.Meta.fields,
            "soft_limit",
            "below_soft_limit",
            "is_ledger_admin",
        ]
        read_only_fields = fields

    def get_below_soft_limit(self, obj) -> bool:
        return Decimal(self.get_balance(obj)) < obj.book.negative_balance_soft_limit

    def get_is_ledger_admin(self, obj) -> bool:
        return self.context["is_ledger_admin"]


class LedgerCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "code", "name", "kind"]
        read_only_fields = fields


class LedgerProjectSerializer(serializers.ModelSerializer):
    budget = serializers.DecimalField(
        source="budget.amount", read_only=True, allow_null=True, **MONEY
    )

    class Meta:
        model = Project
        fields = ["id", "name", "slug", "budget", "starts_on", "ends_on", "is_archived"]
        read_only_fields = fields


class LedgerEntrySerializer(serializers.ModelSerializer):
    account = LedgerAccountRefSerializer(read_only=True)
    amount = serializers.DecimalField(source="amount.amount", read_only=True, **MONEY)
    display_amount = serializers.SerializerMethodField()

    class Meta:
        model = Entry
        fields = [
            "id",
            "account",
            "amount",
            "display_amount",
            "item",
            "memo",
            "reverses_entry",
        ]
        read_only_fields = fields

    @extend_schema_field(serializers.DecimalField(**MONEY))
    def get_display_amount(self, obj) -> str:
        return f"{obj.account.display(obj.amount.amount):.2f}"


class LedgerReceiptSerializer(serializers.ModelSerializer):
    uploaded_by = LedgerAccountRefSerializer(read_only=True, allow_null=True)

    class Meta:
        model = Receipt
        fields = [
            "id",
            "file_name",
            "content_type",
            "size",
            "sha256",
            "uploaded_at",
            "uploaded_by",
        ]
        read_only_fields = fields


class LedgerTransactionSerializer(serializers.ModelSerializer):
    kind = serializers.SerializerMethodField()
    category = LedgerCategorySerializer(read_only=True, allow_null=True)
    project = LedgerProjectSerializer(read_only=True, allow_null=True)
    created_by = LedgerAccountRefSerializer(read_only=True, allow_null=True)
    entries = LedgerEntrySerializer(many=True, read_only=True)
    amount = serializers.SerializerMethodField()
    currency = serializers.CharField(source="book.currency", read_only=True)
    receipt_count = serializers.IntegerField(read_only=True)
    open_disputes = serializers.IntegerField(read_only=True)
    reversed_by = serializers.PrimaryKeyRelatedField(many=True, read_only=True)

    class Meta:
        model = Transaction
        fields = [
            "id",
            "seq",
            "kind",
            "occurred_on",
            "created_at",
            "description",
            "category",
            "project",
            "created_by",
            "source_type",
            "source_id",
            "amount",
            "currency",
            "entries",
            "receipt_count",
            "open_disputes",
            "reverses",
            "reversed_by",
        ]
        read_only_fields = fields

    @extend_schema_field(serializers.ChoiceField(choices=TRANSACTION_KINDS))
    def get_kind(self, obj) -> str:
        return TransactionKind(obj.kind).name.lower()

    @extend_schema_field(serializers.DecimalField(**MONEY))
    def get_amount(self, obj) -> str:
        """The size of the transaction: the sum of its debit legs."""
        total = sum(
            (e.amount.amount for e in obj.entries.all() if e.amount.amount > 0),
            Decimal(0),
        )
        return f"{total:.2f}"


class LedgerDisputeSerializer(serializers.ModelSerializer):
    raised_by = LedgerAccountRefSerializer(read_only=True)
    resolved_by = LedgerAccountRefSerializer(read_only=True, allow_null=True)

    class Meta:
        model = Dispute
        fields = [
            "id",
            "transaction",
            "raised_by",
            "reason",
            "state",
            "created_at",
            "resolved_at",
            "resolved_by",
            "resolution",
        ]
        read_only_fields = fields


class LedgerCommentSerializer(serializers.ModelSerializer):
    author = LedgerAccountRefSerializer(read_only=True)

    class Meta:
        model = TransactionComment
        fields = ["id", "author", "body", "created_at"]
        read_only_fields = fields


class LedgerTransactionDetailSerializer(LedgerTransactionSerializer):
    receipts = serializers.SerializerMethodField()
    disputes = LedgerDisputeSerializer(many=True, read_only=True)
    comments = LedgerCommentSerializer(many=True, read_only=True)
    remaining = serializers.SerializerMethodField()
    can_reverse = serializers.SerializerMethodField()
    cost_share = serializers.SerializerMethodField()

    class Meta(LedgerTransactionSerializer.Meta):
        fields = [
            *LedgerTransactionSerializer.Meta.fields,
            "receipts",
            "meta",
            "disputes",
            "comments",
            "remaining",
            "can_reverse",
            "cost_share",
        ]
        read_only_fields = fields

    @extend_schema_field(LedgerReceiptSerializer(many=True))
    def get_receipts(self, obj):
        """The transaction's receipts, and those of the split it booked."""
        receipts = list(obj.receipts.all())
        cost_share = getattr(obj, "cost_share", None)
        if cost_share is not None:
            receipts += list(
                cost_share.receipts.without_content().select_related(
                    "uploaded_by__owner"
                )
            )
        return LedgerReceiptSerializer(receipts, many=True).data

    @extend_schema_field(serializers.DictField(child=serializers.DecimalField(**MONEY)))
    def get_remaining(self, obj) -> dict:
        """Per entry: the raw amount a correction may still undo."""
        return {
            str(entry.pk): f"{left:.2f}"
            for entry, left in reversible_amounts(obj).items()
        }

    def get_can_reverse(self, obj) -> bool:
        request = self.context.get("request")
        return bool(request and can_reverse(obj, request.user))

    @extend_schema_field(serializers.UUIDField(allow_null=True))
    def get_cost_share(self, obj) -> str | None:
        cost_share = getattr(obj, "cost_share", None)
        return str(cost_share.pk) if cost_share is not None else None


class LedgerIntentSerializer(serializers.Serializer):
    """A manual posting. The server turns it into balanced legs (plan section 7)."""

    intent = serializers.ChoiceField(choices=Intent.choices)
    amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=Decimal("0.01")
    )
    occurred_on = serializers.DateField()
    description = serializers.CharField(max_length=2000)
    category = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.filter(is_active=True),
        required=False,
        allow_null=True,
        help_text="Expense category for expense_for_community, income category "
        "for income. Ignored for the other intents.",
    )
    project = serializers.PrimaryKeyRelatedField(
        queryset=Project.objects.filter(is_archived=False),
        required=False,
        allow_null=True,
    )
    counterparty = serializers.PrimaryKeyRelatedField(
        queryset=Account.objects.filter(type=AccountType.MEMBER, is_active=True),
        required=False,
        allow_null=True,
        help_text="Member account: whom I owe (member_to_member) or who is "
        "paid out (payout).",
    )
    via = serializers.ChoiceField(choices=Via.choices, default=Via.BANK)
    client_key = serializers.CharField(
        max_length=64,
        required=False,
        allow_blank=True,
        help_text="Random key per form; resubmitting it posts nothing new.",
    )
    receipts = serializers.ListField(
        child=serializers.FileField(), required=False, allow_empty=True
    )


class LedgerReceiptUploadSerializer(serializers.Serializer):
    file = serializers.FileField()


class LedgerAccountEntrySerializer(serializers.ModelSerializer):
    """One line of an account statement, with the balance right after it."""

    transaction = serializers.SerializerMethodField()
    amount = serializers.SerializerMethodField()
    balance_after = serializers.SerializerMethodField()
    occurred_on = serializers.DateField(
        source="transaction.occurred_on", read_only=True
    )
    description = serializers.CharField(
        source="transaction.description", read_only=True
    )
    seq = serializers.IntegerField(source="transaction.seq", read_only=True)

    class Meta:
        model = Entry
        fields = [
            "id",
            "transaction",
            "seq",
            "occurred_on",
            "description",
            "amount",
            "balance_after",
            "memo",
        ]
        read_only_fields = fields

    @extend_schema_field(OpenApiTypes.UUID)
    def get_transaction(self, obj) -> str:
        return str(obj.transaction_id)

    @extend_schema_field(serializers.DecimalField(**MONEY))
    def get_amount(self, obj) -> str:
        return f"{obj.account.display(obj.amount.amount):.2f}"

    @extend_schema_field(serializers.DecimalField(**MONEY))
    def get_balance_after(self, obj) -> str:
        return f"{obj.account.display(obj.running_raw):.2f}"


class LedgerHealthSerializer(serializers.Serializer):
    ok = serializers.BooleanField()
    trial_balance = serializers.DecimalField(**MONEY)
    mismatched_accounts = serializers.IntegerField()


class LedgerUnbilledBookingSerializer(serializers.Serializer):
    """A booking that should have been charged but could not be."""

    id = serializers.UUIDField()
    item = serializers.UUIDField(source="item_id")
    item_name = serializers.CharField(source="item.name")
    booker = serializers.SerializerMethodField()
    amount = serializers.DecimalField(
        source="agreed_price.amount", allow_null=True, **MONEY
    )
    currency = serializers.SerializerMethodField()
    note = serializers.CharField(source="ledger_note")
    updated_at = serializers.DateTimeField()

    def get_booker(self, obj) -> str:
        if obj.user_id:
            return obj.user.name or obj.user.username
        actor = obj.remote_booker_actor
        return (actor.name or actor.preferred_username) if actor else ""

    def get_currency(self, obj) -> str:
        return str(obj.agreed_price.currency) if obj.agreed_price is not None else ""


class LedgerCorrectionLineSerializer(serializers.Serializer):
    entry = serializers.UUIDField()
    amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=Decimal("0.00")
    )


class LedgerCorrectionSerializer(serializers.Serializer):
    """Undo part of a transaction: how much of each line, as positive amounts."""

    description = serializers.CharField(
        max_length=2000, required=False, allow_blank=True
    )
    lines = LedgerCorrectionLineSerializer(many=True)


class LedgerReverseSerializer(serializers.Serializer):
    description = serializers.CharField(
        max_length=2000, required=False, allow_blank=True
    )


class LedgerDisputeCreateSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=2000)


class LedgerDisputeResolveSerializer(serializers.Serializer):
    resolution = serializers.CharField(max_length=2000)


class LedgerCommentCreateSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=2000)


class LedgerCostShareParticipantSerializer(serializers.ModelSerializer):
    account = LedgerAccountRefSerializer(read_only=True)
    amount = serializers.DecimalField(
        source="amount.amount", read_only=True, allow_null=True, **MONEY
    )
    share = serializers.SerializerMethodField()

    class Meta:
        model = CostShareParticipant
        fields = [
            "id",
            "account",
            "weight",
            "amount",
            "guests",
            "share",
            "response",
            "responded_at",
            "objection_reason",
        ]
        read_only_fields = fields

    @extend_schema_field(serializers.DecimalField(**MONEY))
    def get_share(self, obj) -> str:
        shares = self.context["shares"]
        return f"{shares.get(str(obj.pk), Decimal(0)):.2f}"


class LedgerCostShareSerializer(serializers.ModelSerializer):
    payer = LedgerAccountRefSerializer(read_only=True)
    total = serializers.DecimalField(source="total.amount", read_only=True, **MONEY)
    currency = serializers.CharField(source="book.currency", read_only=True)
    category = LedgerCategorySerializer(read_only=True, allow_null=True)
    project = LedgerProjectSerializer(read_only=True, allow_null=True)
    participants = serializers.SerializerMethodField()
    payer_share = serializers.SerializerMethodField()
    receipts = serializers.SerializerMethodField()
    my_response = serializers.SerializerMethodField()
    is_payer = serializers.SerializerMethodField()

    class Meta:
        model = CostShare
        fields = [
            "id",
            "payer",
            "description",
            "occurred_on",
            "total",
            "currency",
            "category",
            "project",
            "split",
            "payer_participates",
            "payer_weight",
            "payer_guests",
            "payer_share",
            "auto_accept_at",
            "state",
            "posted_transaction",
            "cancelled_reason",
            "created_at",
            "participants",
            "receipts",
            "my_response",
            "is_payer",
        ]
        read_only_fields = fields

    def _shares(self, obj):
        cache = self.context.setdefault("_cost_share_shares", {})
        if obj.pk not in cache:
            cache[obj.pk] = compute_shares(obj)
        return cache[obj.pk]

    @extend_schema_field(LedgerCostShareParticipantSerializer(many=True))
    def get_participants(self, obj):
        shares, _payer_share = self._shares(obj)
        return LedgerCostShareParticipantSerializer(
            obj.participants.all(), many=True, context={"shares": shares}
        ).data

    @extend_schema_field(serializers.DecimalField(**MONEY))
    def get_payer_share(self, obj) -> str:
        return f"{self._shares(obj)[1]:.2f}"

    @extend_schema_field(LedgerReceiptSerializer(many=True))
    def get_receipts(self, obj):
        return LedgerReceiptSerializer(
            obj.receipts.without_content().select_related("uploaded_by__owner"),
            many=True,
        ).data

    def _user(self):
        request = self.context.get("request")
        return request.user if request else None

    @extend_schema_field(
        serializers.ChoiceField(choices=ParticipantResponse.choices, allow_null=True)
    )
    def get_my_response(self, obj) -> str | None:
        user = self._user()
        for participant in obj.participants.all():
            if user is not None and participant.account.owner_id == user.pk:
                return participant.response
        return None

    def get_is_payer(self, obj) -> bool:
        user = self._user()
        return bool(user and obj.payer.owner_id == user.pk)


class LedgerCostShareParticipantInputSerializer(serializers.Serializer):
    account = serializers.PrimaryKeyRelatedField(
        queryset=Account.objects.filter(type=AccountType.MEMBER, is_active=True)
    )
    weight = serializers.DecimalField(
        max_digits=6, decimal_places=2, min_value=Decimal("0.01"), default=Decimal(1)
    )
    amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True
    )
    guests = serializers.IntegerField(min_value=0, max_value=100, default=0)


class LedgerCostShareWriteSerializer(serializers.Serializer):
    """Create or change a shared expense (the payer is the requesting member)."""

    description = serializers.CharField(max_length=2000)
    total = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=Decimal("0.01")
    )
    occurred_on = serializers.DateField()
    split = serializers.ChoiceField(choices=CostShareSplit.choices, default="equal")
    category = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.filter(is_active=True),
        required=False,
        allow_null=True,
    )
    project = serializers.PrimaryKeyRelatedField(
        queryset=Project.objects.filter(is_archived=False),
        required=False,
        allow_null=True,
    )
    payer_participates = serializers.BooleanField(default=True)
    payer_weight = serializers.DecimalField(
        max_digits=6, decimal_places=2, min_value=Decimal("0.01"), default=Decimal(1)
    )
    payer_guests = serializers.IntegerField(min_value=0, max_value=100, default=0)
    participants = LedgerCostShareParticipantInputSerializer(many=True)


class LedgerCostShareRespondSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=2000, required=False, allow_blank=True)
