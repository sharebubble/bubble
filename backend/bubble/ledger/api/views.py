"""The ledger API (plan section 9).

Everything is readable by every authenticated member (D8): the ledger has no
per-object visibility, so these viewsets do not use ``get_for_user``. Writes go
through ``bubble.ledger.intents``, which enforces who may charge whom.
"""

import csv

from django.db.models import (
    Count,
    Exists,
    F,
    IntegerField,
    OuterRef,
    Prefetch,
    Q,
    Subquery,
    Sum,
    Value,
    Window,
)
from django.db.models.functions import Coalesce
from django.http import HttpResponse
from django.utils import timezone
from django.utils.http import content_disposition_header
from django.utils.text import slugify
from django.utils.translation import gettext_lazy as _
from django_filters import rest_framework as filters
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from moneyed import Money
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from bubble.bookings.models import Booking, BookingLedgerState
from bubble.ledger import cost_shares, disputes
from bubble.ledger.api.serializers import (
    ACCOUNT_TYPES,
    TRANSACTION_KINDS,
    LedgerAccountEntrySerializer,
    LedgerAccountSerializer,
    LedgerAnnualReportQuerySerializer,
    LedgerAnnualReportSerializer,
    LedgerCategorySerializer,
    LedgerCategoryWriteSerializer,
    LedgerCommentCreateSerializer,
    LedgerCommentSerializer,
    LedgerCorrectionSerializer,
    LedgerCostShareRespondSerializer,
    LedgerCostShareSerializer,
    LedgerCostShareWriteSerializer,
    LedgerDisputeCreateSerializer,
    LedgerDisputeResolveSerializer,
    LedgerDisputeSerializer,
    LedgerHealthSerializer,
    LedgerIntentSerializer,
    LedgerMyAccountSerializer,
    LedgerPeriodQuerySerializer,
    LedgerProjectSerializer,
    LedgerProjectWriteSerializer,
    LedgerReceiptSerializer,
    LedgerReceiptUploadSerializer,
    LedgerReverseSerializer,
    LedgerStatementSerializer,
    LedgerStatsQuerySerializer,
    LedgerStatsSerializer,
    LedgerTransactionDetailSerializer,
    LedgerTransactionSerializer,
    LedgerUnbilledBookingSerializer,
    account_name,
)
from bubble.ledger.chart import create_category, unique_code
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
    CategoryKind,
    CostShare,
    CostShareParticipant,
    CostShareState,
    Dispute,
    DisputeState,
    Entry,
    ParticipantResponse,
    Project,
    Receipt,
    ReceiptAccess,
    Transaction,
    TransactionComment,
    TransactionKind,
)
from bubble.ledger.reports import account_statement, annual_report, ledger_stats
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
    disputed = filters.BooleanFilter(
        method="filter_disputed", label="Has an open dispute"
    )
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
        receipts = Receipt.objects.filter(
            Q(transaction=OuterRef("pk"))
            | Q(cost_share__posted_transaction=OuterRef("pk"))
        )
        return queryset.filter(Exists(receipts) if value else ~Exists(receipts))

    def filter_disputed(self, queryset, name, value):
        open_disputes = Dispute.objects.filter(
            transaction=OuterRef("pk"), state=DisputeState.OPEN
        )
        return queryset.filter(
            Exists(open_disputes) if value else ~Exists(open_disputes)
        )


def _count(queryset) -> Coalesce:
    """A correlated COUNT(*) subquery (joins would multiply the counts)."""
    counted = (
        queryset.order_by()
        .annotate(_group=Value(1))
        .values("_group")
        .annotate(n=Count("pk"))
        .values("n")
    )
    return Coalesce(Subquery(counted, output_field=IntegerField()), 0)


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
            .select_related(
                "book", "category", "project", "created_by__owner", "cost_share"
            )
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
                Prefetch(
                    "disputes",
                    queryset=Dispute.objects.select_related(
                        "raised_by__owner", "resolved_by__owner"
                    ),
                ),
                Prefetch(
                    "comments",
                    queryset=TransactionComment.objects.select_related("author__owner"),
                ),
            )
            .annotate(
                receipt_count=_count(
                    Receipt.objects.filter(
                        Q(transaction=OuterRef("pk"))
                        | Q(cost_share__posted_transaction=OuterRef("pk"))
                    )
                ),
                open_disputes=_count(
                    Dispute.objects.filter(
                        transaction=OuterRef("pk"), state=DisputeState.OPEN
                    )
                ),
            )
            .order_by("-seq")
        )

    def get_serializer_class(self):
        if self.action == "list":
            return LedgerTransactionSerializer
        if self.action == "create":
            return LedgerIntentSerializer
        return {
            "receipts": LedgerReceiptUploadSerializer,
            "reverse": LedgerReverseSerializer,
            "correct": LedgerCorrectionSerializer,
            "dispute": LedgerDisputeCreateSerializer,
            "comments": LedgerCommentCreateSerializer,
        }.get(self.action, LedgerTransactionDetailSerializer)

    def _detail(self, tx, status_code=status.HTTP_200_OK):
        tx = self.get_queryset().get(pk=tx.pk)
        return Response(
            LedgerTransactionDetailSerializer(
                tx, context=self.get_serializer_context()
            ).data,
            status=status_code,
        )

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
        return self._detail(tx, status.HTTP_201_CREATED)

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

    @extend_schema(
        request=LedgerReverseSerializer,
        responses={201: LedgerTransactionDetailSerializer},
    )
    @action(detail=True, methods=["post"], parser_classes=[JSONParser])
    def reverse(self, request, id=None):  # noqa: A002
        """Undo everything that is left of the transaction with a new one.

        Allowed for its author, the members it credits (they give it back) and
        the treasurer. Open disputes count as resolved.
        """
        tx = self.get_object()
        serializer = LedgerReverseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            reversal = disputes.reverse(
                tx, request.user, serializer.validated_data.get("description", "")
            )
        except IntentError as exc:
            raise _intent_error(exc) from exc
        return self._detail(reversal, status.HTTP_201_CREATED)

    @extend_schema(
        request=LedgerCorrectionSerializer,
        responses={201: LedgerTransactionDetailSerializer},
    )
    @action(detail=True, methods=["post"], parser_classes=[JSONParser])
    def correct(self, request, id=None):  # noqa: A002
        """Undo part of the transaction, e.g. one participant's share.

        ``lines`` name entries of this transaction and how much of each to undo
        (positive amounts); they must balance.
        """
        tx = self.get_object()
        serializer = LedgerCorrectionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        entries = {str(e.pk): e for e in tx.entries.all()}
        lines = []
        for line in serializer.validated_data["lines"]:
            entry = entries.get(str(line["entry"]))
            if entry is None:
                raise ValidationError(
                    {"lines": [_("That line is not part of this transaction.")]}
                )
            lines.append((entry, line["amount"]))
        try:
            correction = disputes.correct(
                tx,
                request.user,
                lines,
                serializer.validated_data.get("description", ""),
            )
        except IntentError as exc:
            raise _intent_error(exc) from exc
        return self._detail(correction, status.HTTP_201_CREATED)

    @extend_schema(
        request=LedgerDisputeCreateSerializer,
        responses={201: LedgerDisputeSerializer},
    )
    @action(detail=True, methods=["post"], parser_classes=[JSONParser])
    def dispute(self, request, id=None):  # noqa: A002
        """Flag the transaction as wrong. Any member may; it is never changed."""
        tx = self.get_object()
        serializer = LedgerDisputeCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            dispute = disputes.raise_dispute(
                tx, request.user, serializer.validated_data["reason"]
            )
        except IntentError as exc:
            raise _intent_error(exc) from exc
        return Response(
            LedgerDisputeSerializer(dispute).data, status=status.HTTP_201_CREATED
        )

    @extend_schema(
        request=LedgerCommentCreateSerializer,
        responses={201: LedgerCommentSerializer},
    )
    @action(detail=True, methods=["post"], parser_classes=[JSONParser])
    def comments(self, request, id=None):  # noqa: A002
        """Add to the discussion under a transaction. Comments are never edited."""
        tx = self.get_object()
        serializer = LedgerCommentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            comment = disputes.add_comment(
                tx, request.user, serializer.validated_data["body"]
            )
        except IntentError as exc:
            raise _intent_error(exc) from exc
        return Response(
            LedgerCommentSerializer(comment).data, status=status.HTTP_201_CREATED
        )


class DisputeViewSet(mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Answering a dispute: its raiser withdraws it, or the author, the
    members it credits or the treasurer keep the transaction with a reason.
    A reversal or correction (on the transaction) also closes it."""

    permission_classes = [IsAuthenticated]
    serializer_class = LedgerDisputeSerializer
    lookup_field = "id"
    parser_classes = [JSONParser]

    def get_queryset(self):
        return Dispute.objects.filter(
            transaction__book=Book.objects.default()
        ).select_related("transaction", "raised_by__owner", "resolved_by__owner")

    @extend_schema(request=None, responses=LedgerDisputeSerializer)
    @action(detail=True, methods=["post"])
    def withdraw(self, request, id=None):  # noqa: A002
        try:
            dispute = disputes.withdraw_dispute(self.get_object(), request.user)
        except IntentError as exc:
            raise _intent_error(exc) from exc
        return Response(LedgerDisputeSerializer(dispute).data)

    @extend_schema(
        request=LedgerDisputeResolveSerializer, responses=LedgerDisputeSerializer
    )
    @action(detail=True, methods=["post"])
    def uphold(self, request, id=None):  # noqa: A002
        """Keep the transaction as it is, and say why."""
        serializer = LedgerDisputeResolveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            dispute = disputes.uphold_dispute(
                self.get_object(),
                request.user,
                serializer.validated_data["resolution"],
            )
        except IntentError as exc:
            raise _intent_error(exc) from exc
        return Response(LedgerDisputeSerializer(dispute).data)


class CostShareFilter(filters.FilterSet):
    state = filters.ChoiceFilter(choices=CostShareState.choices)
    mine = filters.BooleanFilter(
        method="filter_mine", label="Paid by me or waiting for my answer"
    )
    waiting_for_me = filters.BooleanFilter(
        method="filter_waiting_for_me", label="Waiting for my answer"
    )

    class Meta:
        model = CostShare
        fields = []

    def filter_mine(self, queryset, name, value):
        if not value:
            return queryset
        user = self.request.user
        return queryset.filter(
            Q(payer__owner=user) | Q(participants__account__owner=user)
        ).distinct()

    def filter_waiting_for_me(self, queryset, name, value):
        if not value:
            return queryset
        waiting = CostShareParticipant.objects.filter(
            cost_share=OuterRef("pk"),
            account__owner=self.request.user,
            response=ParticipantResponse.PENDING,
        )
        return queryset.filter(Exists(waiting), state=CostShareState.OPEN)


def _cost_share_input(data) -> cost_shares.CostShareInput:
    return cost_shares.CostShareInput(
        description=data["description"],
        total=data["total"],
        occurred_on=data["occurred_on"],
        split=data["split"],
        category=data.get("category"),
        project=data.get("project"),
        payer_participates=data["payer_participates"],
        payer_weight=data["payer_weight"],
        payer_guests=data["payer_guests"],
        participants=[
            cost_shares.ParticipantInput(
                account=p["account"],
                weight=p["weight"],
                amount=p.get("amount"),
                guests=p["guests"],
            )
            for p in data["participants"]
        ],
    )


class CostShareViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Shared expenses waiting for their participants (plan 7a, D13).

    The payer splits a cost; each participant accepts or objects, and silence
    counts as acceptance after the deadline. Then one SHARED_EXPENSE
    transaction is posted. Visible to every member, like the ledger.
    """

    permission_classes = [IsAuthenticated]
    lookup_field = "id"
    filter_backends = [filters.DjangoFilterBackend]
    filterset_class = CostShareFilter
    parser_classes = [JSONParser]
    http_method_names = ["get", "post", "patch", "put", "head", "options"]

    def get_queryset(self):
        return (
            CostShare.objects.filter(book=Book.objects.default())
            .select_related("book", "payer__owner", "category", "project")
            .prefetch_related(
                Prefetch(
                    "participants",
                    queryset=CostShareParticipant.objects.select_related(
                        "account__owner"
                    ).order_by("account__name", "id"),
                )
            )
            .order_by("-created_at")
        )

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return LedgerCostShareWriteSerializer
        if self.action == "receipts":
            return LedgerReceiptUploadSerializer
        if self.action in ("accept", "object", "cancel"):
            return LedgerCostShareRespondSerializer
        return LedgerCostShareSerializer

    def _read(self, cs, status_code=status.HTTP_200_OK):
        cs = self.get_queryset().get(pk=cs.pk)
        return Response(
            LedgerCostShareSerializer(cs, context=self.get_serializer_context()).data,
            status=status_code,
        )

    @extend_schema(
        request=LedgerCostShareWriteSerializer,
        responses={201: LedgerCostShareSerializer},
    )
    def create(self, request, *args, **kwargs):
        serializer = LedgerCostShareWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            cs = cost_shares.create_cost_share(
                _cost_share_input(serializer.validated_data), user=request.user
            )
        except IntentError as exc:
            raise _intent_error(exc) from exc
        return self._read(cs, status.HTTP_201_CREATED)

    @extend_schema(
        request=LedgerCostShareWriteSerializer,
        responses=LedgerCostShareSerializer,
    )
    def update(self, request, *args, **kwargs):
        """The payer changes an open split; every participant is asked again."""
        cs = self.get_object()
        serializer = LedgerCostShareWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            cs = cost_shares.update_cost_share(
                cs, _cost_share_input(serializer.validated_data), user=request.user
            )
        except IntentError as exc:
            raise _intent_error(exc) from exc
        return self._read(cs)

    @extend_schema(
        request=LedgerCostShareWriteSerializer,
        responses=LedgerCostShareSerializer,
    )
    def partial_update(self, request, *args, **kwargs):
        # A split is always replaced as a whole, so PATCH behaves like PUT.
        return self.update(request, *args, **kwargs)

    def _respond(self, request, *, accept: bool):
        serializer = LedgerCostShareRespondSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            cs = cost_shares.respond(
                self.get_object(),
                user=request.user,
                accept=accept,
                reason=serializer.validated_data.get("reason", ""),
            )
        except IntentError as exc:
            raise _intent_error(exc) from exc
        return self._read(cs)

    @extend_schema(
        request=LedgerCostShareRespondSerializer,
        responses=LedgerCostShareSerializer,
    )
    @action(detail=True, methods=["post"])
    def accept(self, request, id=None):  # noqa: A002
        """I agree to my share."""
        return self._respond(request, accept=True)

    @extend_schema(
        request=LedgerCostShareRespondSerializer,
        responses=LedgerCostShareSerializer,
    )
    @action(detail=True, methods=["post"])
    def object(self, request, id=None):  # noqa: A002
        """I do not agree to my share (a reason is required). The payer carries
        it for now and may change or cancel the split."""
        return self._respond(request, accept=False)

    @extend_schema(
        request=LedgerCostShareRespondSerializer,
        responses=LedgerCostShareSerializer,
    )
    @action(detail=True, methods=["post"])
    def cancel(self, request, id=None):  # noqa: A002
        """The payer (or the treasurer) withdraws an open split."""
        serializer = LedgerCostShareRespondSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            cs = cost_shares.cancel_cost_share(
                self.get_object(),
                user=request.user,
                reason=serializer.validated_data.get("reason", ""),
            )
        except IntentError as exc:
            raise _intent_error(exc) from exc
        return self._read(cs)

    @extend_schema(
        request={"multipart/form-data": LedgerReceiptUploadSerializer},
        responses={201: LedgerReceiptSerializer},
    )
    @action(detail=True, methods=["post"], parser_classes=[MultiPartParser])
    def receipts(self, request, id=None):  # noqa: A002
        """The payer attaches a receipt; it stays with the booked transaction."""
        cs = self.get_object()
        serializer = LedgerReceiptUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            receipt = cost_shares.add_cost_share_receipt(
                cs, serializer.validated_data["file"], user=request.user
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

    @extend_schema(
        parameters=[LedgerPeriodQuerySerializer],
        responses=LedgerStatementSerializer,
    )
    @action(detail=True, methods=["get"])
    def statement(self, request, id=None):  # noqa: A002
        """Statement for a period (default: this year) with opening and closing
        balance and the balance after each line, by business date (plan D12)."""
        period = _period(request)
        statement = account_statement(
            self.get_object(), period["date_from"], period["date_to"]
        )
        return Response(LedgerStatementSerializer(statement).data)

    @extend_schema(
        parameters=[LedgerPeriodQuerySerializer],
        responses={(200, "text/csv"): OpenApiResponse(OpenApiTypes.BINARY)},
    )
    @action(detail=True, methods=["get"], url_path="statement/csv")
    def statement_csv(self, request, id=None):  # noqa: A002
        """The same statement as a spreadsheet."""
        period = _period(request)
        account = self.get_object()
        statement = account_statement(account, period["date_from"], period["date_to"])
        rows = [
            ["", "", "", str(_("Opening balance")), "", statement.opening_balance],
            *(
                [
                    line.entry.transaction.occurred_on.isoformat(),
                    line.entry.transaction.seq,
                    TransactionKind(line.entry.transaction.kind).label,
                    line.entry.transaction.description,
                    line.amount,
                    line.balance_after,
                ]
                for line in statement.lines
            ),
            ["", "", "", str(_("Closing balance")), "", statement.closing_balance],
        ]
        name = slugify(account_name(account)) or "account"
        return _csv_response(
            f"statement-{name}-{statement.date_from}-{statement.date_to}.csv",
            [
                str(_("Date")),
                "#",
                str(_("Kind")),
                str(_("Description")),
                str(_("Amount")),
                str(_("Balance")),
            ],
            rows,
        )


class TreasurerWritesMixin:
    """Everyone reads; only the treasurer creates or changes. Nothing is deleted."""

    http_method_names = ["get", "post", "patch", "head", "options"]

    def _require_treasurer(self):
        if not is_ledger_admin(self.request.user):
            raise PermissionDenied(_("Only the treasurer can change this."))

    def _include_hidden(self) -> bool:
        return self.request.query_params.get(
            "include_hidden"
        ) == "true" and is_ledger_admin(self.request.user)


def _csv_response(filename: str, header: list[str], rows) -> HttpResponse:
    """A CSV download that opens cleanly in spreadsheet apps (UTF-8 with BOM)."""
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = content_disposition_header(
        as_attachment=True, filename=filename
    )
    response.write("\ufeff")
    writer = csv.writer(response)
    writer.writerow(header)
    writer.writerows(rows)
    return response


def _period(request) -> dict:
    serializer = LedgerPeriodQuerySerializer(data=request.query_params)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


class CategoryViewSet(
    TreasurerWritesMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Categories to pick when posting. The treasurer adds income and expense
    categories and renames, reorders or retires them (``is_active``);
    ``?include_hidden=true`` lists retired ones too (treasurer only)."""

    permission_classes = [IsAuthenticated]
    serializer_class = LedgerCategorySerializer
    lookup_field = "id"
    pagination_class = None
    filter_backends = [filters.DjangoFilterBackend]
    filterset_fields = ["kind"]
    parser_classes = [JSONParser]

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "include_hidden", bool, description="Also retired ones (treasurer)"
            )
        ]
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        categories = Category.objects.filter(book=Book.objects.default())
        if self.action == "list" and not self._include_hidden():
            categories = categories.filter(is_active=True)
        return categories

    @extend_schema(
        request=LedgerCategoryWriteSerializer,
        responses={201: LedgerCategorySerializer},
    )
    def create(self, request, *args, **kwargs):
        self._require_treasurer()
        serializer = LedgerCategoryWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if "kind" not in data:
            raise ValidationError({"kind": [_("Choose income or expense.")]})
        book = Book.objects.default()
        account = data.get("account")
        if account is not None and (
            account.book_id != book.pk
            or account.type
            != (
                AccountType.INCOME
                if data["kind"] == CategoryKind.INCOME
                else AccountType.EXPENSE
            )
        ):
            raise ValidationError({"account": [_("Pick an account of the same kind.")]})
        category = create_category(
            book,
            name=data["name"].strip(),
            kind=data["kind"],
            account=account,
            sort_order=data.get("sort_order"),
        )
        if data.get("is_active") is False:
            category.is_active = False
            category.save(update_fields=["is_active"])
        return Response(
            LedgerCategorySerializer(category).data, status=status.HTTP_201_CREATED
        )

    @extend_schema(
        request=LedgerCategoryWriteSerializer, responses=LedgerCategorySerializer
    )
    def partial_update(self, request, *args, **kwargs):
        """Rename, reorder or retire a category; its kind and account stay."""
        self._require_treasurer()
        category = self.get_object()
        if category.kind == CategoryKind.TRANSFER:
            raise ValidationError(
                {"non_field_errors": [_("Transfer categories cannot be changed.")]}
            )
        serializer = LedgerCategoryWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if "kind" in data and data["kind"] != category.kind:
            raise ValidationError({"kind": [_("The kind cannot be changed.")]})
        for field in ("name", "sort_order", "is_active"):
            if field in data:
                setattr(category, field, data[field])
        category.name = category.name.strip()
        category.save()
        return Response(LedgerCategorySerializer(category).data)


class ProjectViewSet(
    TreasurerWritesMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Projects (cost centres) with an optional budget. The treasurer creates
    and archives them; ``?include_hidden=true`` lists archived ones too."""

    permission_classes = [IsAuthenticated]
    serializer_class = LedgerProjectSerializer
    lookup_field = "id"
    pagination_class = None
    parser_classes = [JSONParser]

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "include_hidden", bool, description="Also retired ones (treasurer)"
            )
        ]
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        projects = Project.objects.filter(book=Book.objects.default()).order_by(
            "is_archived", "name"
        )
        if self.action == "list" and not self._include_hidden():
            projects = projects.filter(is_archived=False)
        return projects

    def _save(self, project: Project, data: dict) -> Project:
        book = project.book
        if "name" in data:
            project.name = data["name"].strip()
        if not project.slug:
            project.slug = unique_code(
                Project.objects.filter(book=book),
                "slug",
                slugify(project.name)[:190] or "project",
                max_length=200,
            )
        if "budget" in data:
            budget = data["budget"]
            project.budget = (
                Money(budget, book.currency) if budget is not None else None
            )
        for field in ("starts_on", "ends_on", "is_archived"):
            if field in data:
                setattr(project, field, data[field])
        project.save()
        return project

    @extend_schema(
        request=LedgerProjectWriteSerializer,
        responses={201: LedgerProjectSerializer},
    )
    def create(self, request, *args, **kwargs):
        self._require_treasurer()
        serializer = LedgerProjectWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        project = self._save(
            Project(book=Book.objects.default()), serializer.validated_data
        )
        return Response(
            LedgerProjectSerializer(project).data, status=status.HTTP_201_CREATED
        )

    @extend_schema(
        request=LedgerProjectWriteSerializer, responses=LedgerProjectSerializer
    )
    def partial_update(self, request, *args, **kwargs):
        self._require_treasurer()
        project = self.get_object()
        serializer = LedgerProjectWriteSerializer(
            project, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        project = self._save(project, serializer.validated_data)
        return Response(LedgerProjectSerializer(project).data)


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

    @extend_schema(
        parameters=[LedgerStatsQuerySerializer], responses=LedgerStatsSerializer
    )
    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Totals for a period, grouped by category, project, month, member,
        item or kind (plan D7). Reversals and corrections count against what
        they undo."""
        query = LedgerStatsQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        stats = ledger_stats(**query.validated_data)
        return Response(LedgerStatsSerializer(stats).data)

    def _report(self, request):
        query = LedgerAnnualReportQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        return annual_report(
            query.validated_data.get("year") or timezone.localdate().year
        )

    @extend_schema(
        parameters=[LedgerAnnualReportQuerySerializer],
        responses=LedgerAnnualReportSerializer,
    )
    @action(detail=False, methods=["get"], url_path="reports/annual")
    def annual_report(self, request):
        """The treasurer's yearly overview, readable by every member (D8, D12)."""
        return Response(LedgerAnnualReportSerializer(self._report(request)).data)

    @extend_schema(
        parameters=[LedgerAnnualReportQuerySerializer],
        responses={(200, "text/csv"): OpenApiResponse(OpenApiTypes.BINARY)},
    )
    @action(detail=False, methods=["get"], url_path="reports/annual/csv")
    def annual_report_csv(self, request):
        """The annual report as one spreadsheet: section, line, amounts."""
        report = self._report(request)
        rows = [
            *([str(_("Income")), r.label, r.income, ""] for r in report.income),
            [str(_("Income")), str(_("Total")), report.total_income, ""],
            *([str(_("Expenses")), r.label, r.expense, ""] for r in report.expense),
            [str(_("Expenses")), str(_("Total")), report.total_expense, ""],
            [str(_("Result")), "", report.result, ""],
            *(
                [str(_("Projects")), r.label, r.income - r.expense, r.budget or ""]
                for r in report.projects
            ),
            *(
                [str(_("Money")), p.account.name, p.closing, p.opening]
                for p in report.money
            ),
            *(
                [str(_("Members")), account_name(p.account), p.closing, p.opening]
                for p in report.members
            ),
            *(
                [str(_("Other accounts")), p.account.name, p.closing, p.opening]
                for p in report.other
            ),
            [str(_("Check")), str(_("Trial balance")), report.trial_balance, ""],
        ]
        return _csv_response(
            f"annual-report-{report.year}.csv",
            [
                str(_("Section")),
                str(_("Line")),
                str(_("Amount / closing")),
                str(_("Budget / opening")),
            ],
            rows,
        )

    @extend_schema(responses=LedgerUnbilledBookingSerializer(many=True))
    @action(detail=False, methods=["get"])
    def unbilled(self, request):
        """Bookings that should have been charged but could not be (treasurer).

        For example a booker on another instance, or a price in another
        currency. The reason is in ``note``.
        """
        if not is_ledger_admin(request.user):
            raise PermissionDenied(_("Only the treasurer can see unbilled bookings."))
        bookings = (
            Booking.objects.filter(ledger_state=BookingLedgerState.UNBILLED)
            .select_related("item", "user", "remote_booker_actor")
            .order_by("-updated_at")
        )
        return Response(LedgerUnbilledBookingSerializer(bookings, many=True).data)
