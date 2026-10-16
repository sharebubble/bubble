"""Seed the community book, its chart of accounts, and one account per member.

The account and category lists are a frozen copy of bubble/ledger/chart.py as
of this migration. Later additions go into new data migrations.
"""

from django.conf import settings
from django.db import migrations
from guardian.conf import settings as guardian_settings
from django.utils import timezone

ASSET, INCOME, EXPENSE, EQUITY, SUSPENSE, MEMBER = 2, 3, 4, 5, 6, 1
DEBIT, CREDIT = 1, -1
NORMAL_SIDE = {
    MEMBER: CREDIT,
    ASSET: DEBIT,
    INCOME: CREDIT,
    EXPENSE: DEBIT,
    EQUITY: CREDIT,
    SUSPENSE: CREDIT,
}

SYSTEM_ACCOUNTS = [
    ("asset:bank", "Bank account", ASSET),
    ("asset:cash", "Cash box", ASSET),
    ("income:rental", "Rental income", INCOME),
    ("income:sales", "Sales of community items", INCOME),
    ("income:membership", "Membership fees", INCOME),
    ("income:donation", "Donations", INCOME),
    ("expense:tools", "Tools and equipment", EXPENSE),
    ("expense:consumables", "Consumables", EXPENSE),
    ("expense:repairs", "Repairs and maintenance", EXPENSE),
    ("expense:food", "Food and catering", EXPENSE),
    ("expense:events", "Events", EXPENSE),
    ("expense:rent", "Rent and utilities", EXPENSE),
    ("expense:other", "Other expenses", EXPENSE),
    ("equity:opening", "Opening balances", EQUITY),
    ("suspense:unmatched", "Unmatched bank lines", SUSPENSE),
]

CATEGORIES = [
    ("rental", "Rental", "income", "income:rental"),
    ("sale", "Sale", "income", "income:sales"),
    ("membership", "Membership fee", "income", "income:membership"),
    ("donation", "Donation", "income", "income:donation"),
    ("tools", "Tools and equipment", "expense", "expense:tools"),
    ("consumables", "Consumables", "expense", "expense:consumables"),
    ("repairs", "Repairs and maintenance", "expense", "expense:repairs"),
    ("food", "Food and catering", "expense", "expense:food"),
    ("events", "Events", "expense", "expense:events"),
    ("rent", "Rent and utilities", "expense", "expense:rent"),
    ("other-expense", "Other expense", "expense", "expense:other"),
    ("top-up", "Top-up", "transfer", None),
    ("payout", "Payout", "transfer", None),
    ("member-transfer", "Between members", "transfer", None),
    ("shared-expense", "Shared expense", "transfer", None),
    ("correction", "Correction", "transfer", None),
]


def seed(apps, schema_editor):
    Book = apps.get_model("ledger", "Book")
    Account = apps.get_model("ledger", "Account")
    AccountBalance = apps.get_model("ledger", "AccountBalance")
    Category = apps.get_model("ledger", "Category")
    User = apps.get_model(*settings.AUTH_USER_MODEL.split("."))

    book, _ = Book.objects.get_or_create(
        slug="default",
        defaults={
            "name": "Community",
            "currency": settings.DEFAULT_CURRENCY,
            "opened_on": timezone.localdate(),
        },
    )

    def open_account(code, name, account_type, owner=None):
        account, _ = Account.objects.get_or_create(
            book=book,
            code=code,
            defaults={
                "name": name,
                "type": account_type,
                "normal_side": NORMAL_SIDE[account_type],
                "owner": owner,
            },
        )
        AccountBalance.objects.get_or_create(account=account)
        return account

    accounts = {code: open_account(code, name, t) for code, name, t in SYSTEM_ACCOUNTS}
    for order, (code, name, kind, account_code) in enumerate(CATEGORIES):
        Category.objects.get_or_create(
            book=book,
            code=code,
            defaults={
                "name": name,
                "kind": kind,
                "account": accounts[account_code] if account_code else None,
                "sort_order": order,
            },
        )
    # django-guardian's AnonymousUser is a technical row, not a member.
    members = User.objects.exclude(username=guardian_settings.ANONYMOUS_USER_NAME)
    for user in members.iterator():
        open_account(f"member:{user.pk}", user.name or user.username, MEMBER, user)


class Migration(migrations.Migration):
    dependencies = [
        ("ledger", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
