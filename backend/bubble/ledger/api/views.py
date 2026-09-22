"""The ledger API (plan section 9).

Everything is readable by every authenticated member (D8): the ledger has no
per-object visibility, so these viewsets do not use ``get_for_user``. Writes go
through ``bubble.ledger.intents``, which enforces who may charge whom.
"""

from django.db.models import Count, Exists, F, OuterRef, Prefetch, Q, Sum, Window
from django.http import HttpResponse
from django.utils.http import content_disposition_header
from django_filters import rest_framework as filters
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from bubble.ledger.api.serializers import (
    ACCOUNT_TYPES,
    TRANSACTION_KINDS,
    LedgerAccountEntrySerializer,
    LedgerAccountSerializer,
    LedgerCategorySerializer,
    LedgerHealthSerializer,
    LedgerIntentSerializer,
    LedgerMyAccountSerializer,
    LedgerProjectSerializer,
    LedgerReceiptSerializer,
    LedgerReceiptUploadSerializer,
    LedgerTransactionDetailSerializer,
    LedgerTransactionSerializer,
)
from bubble.ledger.intents import (
    IntentError,
    IntentForbiddenError,
    ManualPosting,
    add_receipt,
    is_ledger_admin,
    post_intent,
)
from bubble.ledger.models import (
    Account,
    AccountType,
    Book,
    Category,
    Entry,
    Project,
    Receipt,
    ReceiptAccess,
    Transaction,
    TransactionKind,
)
from bubble.ledger.services import get_member_account, verify_ledger


def _intent_error(exc: IntentError) -> APIException:
    message = exc.user_message
    if isinstance(exc, IntentForbiddenError):
        return PermissionDenied(message)
    return ValidationError({exc.field or "non_field_errors": [message]})


class TransactionFilter(filters.FilterSet):
    kind = filters.MultipleChoiceFilter(
        choices=[(k, k) for k in TRANSACTION_KINDS], method="filter_kind"
    )
    account = filters.UUIDFilter(method="filter_account", label="Account id")
    member = filters.UUIDFilter(method="filter_member", label="User id")
    category = filters.UUIDFilter(field_name="category")
    project = filters.UUIDFilter(field_name="project")
    item = filters.UUIDFilter(method="filter_item", label="Item id")
    date_from = filters.DateFilter(field_name="occurred_on", lookup_expr="gte")
    date_to = filters.DateFilter(field_name="occurred_on", lookup_expr="lte")
    has_receipt = filters.BooleanFilter(method="filter_has_receipt")
    q = filters.CharFilter(field_name="description", lookup_expr="icontains")

    class Meta:
        model = Transaction
        fields = []

    def filter_kind(self, queryset, name, value):
        return queryset.filter(kind__in=[TransactionKind[v.upper()] for v in value])

    def _with_entry(self, queryset, **lookup):
        entries = Entry.objects.filter(transaction=OuterRef("pk"), **lookup)
        return queryset.filter(Exists(entries))

    def filter_account(self, queryset, name, value):
        return self._with_entry(queryset, account_id=value)

    def filter_member(self, queryset, name, value):
        return self._with_entry(queryset, account__owner_id=value)

    def filter_item(self, queryset, name, value):
        return self._with_entry(queryset, item_id=value)

    def filter_has_receipt(self, queryset, name, value):
        receipts = Receipt.objects.filter(transaction=OuterRef("pk"))
        return queryset.filter(Exists(receipts) if value else ~Exists(receipts))


class TransactionViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """Every transaction in the community book, newest first (D8).

    ``POST`` takes an intent such as "I paid 50 € for the community" and posts
    it; the request may carry receipt files as multipart ``receipts``. Posted
    transactions are never changed or deleted.
    """

    permission_classes = [IsAuthenticated]
    lookup_field = "id"
    filter_backends = [filters.DjangoFilterBackend]
    filterset_class = TransactionFilter
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        return (
            Transaction.objects.filter(book=Book.objects.default())
            .select_related("book", "category", "project", "created_by__owner")
            .prefetch_related(
                Prefetch(
                    "entries",
                    queryset=Entry.objects.select_related("account__owner").order_by(
                        "-amount", "account__code"
                    ),
                ),
                Prefetch(
                    "receipts",
                    queryset=Receipt.objects.without_content().select_related(
                        "uploaded_by__owner"
                    ),
                ),
                "reversed_by",
            )
            .annotate(receipt_count=Count("receipts", distinct=True))
            .order_by("-seq")
        )

    def get_serializer_class(self):
        if self.action == "list":
            return LedgerTransactionSerializer
        if self.action == "create":
            return LedgerIntentSerializer
        if self.action == "receipts":
            return LedgerReceiptUploadSerializer
        return LedgerTransactionDetailSerializer

    @extend_schema(
        request={"multipart/form-data": LedgerIntentSerializer},
        responses={201: LedgerTransactionDetailSerializer},
    )
    def create(self, request, *args, **kwargs):
        serializer = LedgerIntentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        posting = ManualPosting(
            intent=data["intent"],
            amount=data["amount"],
            occurred_on=data["occurred_on"],
            description=data["description"],
            category=data.get("category"),
            project=data.get("project"),
            counterparty=data.get("counterparty"),
            via=data["via"],
            client_key=data.get("client_key", ""),
        )
        try:
            tx = post_intent(
                posting, user=request.user, receipts=data.get("receipts", [])
            )
        except IntentError as exc:
            raise _intent_error(exc) from exc
        tx = self.get_queryset().get(pk=tx.pk)
        return Response(
            LedgerTransactionDetailSerializer(tx, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(
        request={"multipart/form-data": LedgerReceiptUploadSerializer},
        responses={201: LedgerReceiptSerializer},
    )
    @action(detail=True, methods=["post"], parser_classes=[MultiPartParser])
    def receipts(self, request, id=None):  # noqa: A002
        """Attach another receipt. Only the author or the treasurer may; receipts
        are never replaced or removed."""
        tx = self.get_object()
        serializer = LedgerReceiptUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            receipt = add_receipt(
                tx, serializer.validated_data["file"], user=request.user
            )
        except IntentError as exc:
            raise _intent_error(exc) from exc
        receipt = Receipt.objects.without_content().get(pk=receipt.pk)
        return Response(
            LedgerReceiptSerializer(receipt).data, status=status.HTTP_201_CREATED
        )


class AccountFilter(filters.FilterSet):
    type = filters.ChoiceFilter(
        choices=[(t, t) for t in ACCOUNT_TYPES], method="filter_type"
    )
    q = filters.CharFilter(method="filter_q")
    is_active = filters.BooleanFilter()

    class Meta:
        model = Account
        fields = []

    def filter_type(self, queryset, name, value):
        return queryset.filter(type=AccountType[value.upper()])

    def filter_q(self, queryset, name, value):
        return queryset.filter(
            Q(name__icontains=value)
            | Q(code__icontains=value)
            | Q(owner__name__icontains=value)
            | Q(owner__username__icontains=value)
        )


class AccountViewSet(viewsets.ReadOnlyModelViewSet):
    """The chart of accounts and every member's balance (D8).

    ``?type=member`` lists the member balances. Balances are display balances:
    for a member, positive means the community owes them money.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = LedgerAccountSerializer
    lookup_field = "id"
    filter_backends = [filters.DjangoFilterBackend]
    filterset_class = AccountFilter

    def get_queryset(self):
        return (
            Account.objects.filter(book=Book.objects.default())
            .select_related("book", "balance", "owner")
            .order_by("type", "code")
        )

    @extend_schema(responses=LedgerMyAccountSerializer)
    @action(detail=False, methods=["get"])
    def me(self, request):
        """My own account, balance and soft-limit state."""
        account = get_member_account(request.user)
        account = self.get_queryset().get(pk=account.pk)
        context = {
            **self.get_serializer_context(),
            "is_ledger_admin": is_ledger_admin(request.user),
        }
        return Response(LedgerMyAccountSerializer(account, context=context).data)

    @extend_schema(responses=LedgerAccountEntrySerializer(many=True))
    @action(detail=True, methods=["get"])
    def entries(self, request, id=None):  # noqa: A002
        """The account statement: every entry, newest first, with the balance
        right after it."""
        account = self.get_object()
        entries = (
            Entry.objects.filter(account=account)
            .select_related("account", "transaction")
            .annotate(
                running_raw=Window(
                    Sum("amount"),
                    order_by=[F("transaction__seq").asc(), F("id").asc()],
                )
            )
            .order_by("-transaction__seq", "-id")
        )
        page = self.paginate_queryset(entries)
        serializer = LedgerAccountEntrySerializer(page, many=True)
        return self.get_paginated_response(serializer.data)


class CategoryViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = LedgerCategorySerializer
    lookup_field = "id"
    pagination_class = None
    filter_backends = [filters.DjangoFilterBackend]
    filterset_fields = ["kind"]

    def get_queryset(self):
        return Category.objects.filter(book=Book.objects.default(), is_active=True)


class ProjectViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = LedgerProjectSerializer
    lookup_field = "id"
    pagination_class = None

    def get_queryset(self):
        return Project.objects.filter(
            book=Book.objects.default(), is_archived=False
        ).order_by("name")


class ReceiptViewSet(viewsets.GenericViewSet):
    """Receipt files: authenticated members only, every download logged (D8)."""

    permission_classes = [IsAuthenticated]
    lookup_field = "id"
    queryset = Receipt.objects.all()

    @extend_schema(
        responses={
            (200, "application/octet-stream"): OpenApiResponse(OpenApiTypes.BINARY)
        }
    )
    @action(detail=True, methods=["get"])
    def file(self, request, id=None):  # noqa: A002
        receipt = self.get_object()
        ReceiptAccess.objects.create(
            receipt=receipt, accessed_by=get_member_account(request.user)
        )
        response = HttpResponse(
            bytes(receipt.content), content_type=receipt.content_type
        )
        # Always a download, never rendered in our origin.
        response["Content-Disposition"] = content_disposition_header(
            as_attachment=True, filename=receipt.file_name
        )
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        response["Content-Security-Policy"] = "default-src 'none'; sandbox"
        return response


class LedgerViewSet(viewsets.ViewSet):
    """Book-wide endpoints that do not belong to a single resource."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=LedgerHealthSerializer)
    @action(detail=False, methods=["get"])
    def health(self, request):
        """Is the ledger consistent right now? Shown as a banner when it is not."""
        result = verify_ledger()
        data = {
            "ok": result.ok,
            "trial_balance": result.trial_balance,
            "mismatched_accounts": len(result.mismatched_accounts),
        }
        return Response(LedgerHealthSerializer(data).data)
