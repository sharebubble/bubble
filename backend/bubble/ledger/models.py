"""A double-entry ledger for money moving inside the community.

Bubble records payments rather than processing them: the money itself changes
hands off-platform (cash, bank transfer), and the ledger is the shared record
of who paid whom, for what, and when. Amounts are in ``DEFAULT_CURRENCY``.

The shape is deliberately conventional double-entry:

* every :class:`Transaction` carries two or more :class:`Posting` rows whose
  amounts sum to zero — money always comes *from* somewhere and goes *to*
  somewhere;
* postings are immutable. A mistake is corrected by a reversing transaction,
  never by editing history;
* balances are **derived** by summing postings, never stored on the account.

That last point is the reason for the whole structure. A mutable
``balance`` column drifts the first time a request fails mid-write or two
bookings settle concurrently, and once it disagrees with history there is no
way to tell which is right. Summed postings cannot disagree with the entries
they are summed from, and "why is my balance this?" always has an answer.
"""

import uuid

from django.conf import settings
from django.db import models
from django.db.models import Sum
from django.utils.translation import gettext_lazy as _
from djmoney.models.fields import MoneyField
from moneyed import Money

from bubble.items.models import money_defaults
from config.settings.base import AUTH_USER_MODEL


class AccountKind(models.TextChoices):
    """What sits behind an account."""

    MEMBER = "member", _("Member")
    # The counterparty whenever value enters or leaves the community — a
    # shop, a landlord, the outside world. Phase 1 does not post to it yet;
    # external expenses will.
    EXTERNAL = "external", _("External")


class TransactionKind(models.TextChoices):
    """Why a transaction exists."""

    BOOKING_PAYMENT = "booking_payment", _("Booking payment")
    REVERSAL = "reversal", _("Reversal")


class AccountManager(models.Manager):
    def for_user(self, user) -> "Account":
        """Return this user's account, creating it on first use."""
        account, _created = self.get_or_create(
            user=user, defaults={"kind": AccountKind.MEMBER}
        )
        return account


class Account(models.Model):
    """One side of a posting: a member, or the outside world."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(
        max_length=20,
        choices=AccountKind,
        default=AccountKind.MEMBER,
        help_text=_("Whether this account belongs to a member or to the outside."),
    )
    user = models.OneToOneField(
        AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ledger_account",
        null=True,
        blank=True,
        help_text=_("The member this account belongs to. Null for external ones."),
    )
    created_at = models.DateTimeField(auto_now_add=True)

    objects = AccountManager()

    class Meta:
        verbose_name = _("Account")
        verbose_name_plural = _("Accounts")
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(kind=AccountKind.MEMBER, user__isnull=False)
                    | models.Q(kind=AccountKind.EXTERNAL, user__isnull=True)
                ),
                name="ledger_member_account_has_user",
            ),
        ]

    def __str__(self):
        return f"{self.get_kind_display()} account for {self.user or 'external'}"

    @property
    def balance(self) -> Money:
        """Sum of every posting on this account.

        Positive means the community owes this member (they have paid more in
        than they have taken out); negative means they still owe.
        """
        total = self.postings.aggregate(total=Sum("amount"))["total"]
        return Money(total or 0, settings.DEFAULT_CURRENCY)


class Transaction(models.Model):
    """An immutable, balanced movement of money."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=32, choices=TransactionKind)
    booking = models.ForeignKey(
        "bookings.Booking",
        on_delete=models.CASCADE,
        related_name="ledger_transactions",
        null=True,
        blank=True,
        help_text=_("The booking this transaction settles, when it settles one."),
    )
    description = models.CharField(max_length=255, blank=True)
    # Who entered the record — not necessarily who paid.
    recorded_by = models.ForeignKey(
        AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="recorded_ledger_transactions",
    )
    voluntary = models.BooleanField(
        default=False,
        help_text=_(
            "Set when the payer chose the amount freely after a free booking, "
            "rather than settling an agreed price."
        ),
    )
    # Makes a retried or double-submitted write land once. Callers derive it
    # from what the transaction represents (e.g. the booking it settles).
    idempotency_key = models.CharField(max_length=200, unique=True)
    reverses = models.OneToOneField(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="reversed_by",
        help_text=_("The transaction this one cancels out, for corrections."),
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = _("Transaction")
        verbose_name_plural = _("Transactions")
        indexes = [
            models.Index(fields=["booking", "-created_at"], name="ledger_booking_idx"),
        ]

    def __str__(self):
        return f"{self.get_kind_display()} {self.id}"


class Posting(models.Model):
    """One account's share of a transaction.

    Signed: negative leaves the account, positive arrives. The postings of a
    transaction always sum to zero — enforced by
    :func:`bubble.ledger.services.record_transaction`, which is the only
    supported way to write them.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    transaction = models.ForeignKey(
        Transaction, on_delete=models.CASCADE, related_name="postings"
    )
    account = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name="postings"
    )
    amount = MoneyField(
        **money_defaults,
        default_currency=settings.DEFAULT_CURRENCY,
        help_text=_("Signed: negative leaves the account, positive arrives."),
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        verbose_name = _("Posting")
        verbose_name_plural = _("Postings")
        indexes = [
            models.Index(fields=["account", "-created_at"], name="ledger_account_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(amount=0),
                name="ledger_posting_not_zero",
            ),
        ]

    def __str__(self):
        return f"{self.amount} on {self.account_id}"
