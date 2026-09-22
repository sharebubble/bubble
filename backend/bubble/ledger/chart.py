"""The default chart of accounts and categories seeded into every new book.

Migration 0002 seeds a frozen copy of these lists; keep them in sync when you
add accounts, and add new rows through a new data migration rather than by
editing old ones.
"""

from bubble.ledger.models import (
    Account,
    AccountBalance,
    AccountType,
    Book,
    Category,
    CategoryKind,
)

SYSTEM_ACCOUNTS: list[tuple[str, str, int]] = [
    ("asset:bank", "Bank account", AccountType.ASSET),
    ("asset:cash", "Cash box", AccountType.ASSET),
    ("income:rental", "Rental income", AccountType.INCOME),
    ("income:sales", "Sales of community items", AccountType.INCOME),
    ("income:membership", "Membership fees", AccountType.INCOME),
    ("income:donation", "Donations", AccountType.INCOME),
    ("expense:tools", "Tools and equipment", AccountType.EXPENSE),
    ("expense:consumables", "Consumables", AccountType.EXPENSE),
    ("expense:repairs", "Repairs and maintenance", AccountType.EXPENSE),
    ("expense:food", "Food and catering", AccountType.EXPENSE),
    ("expense:events", "Events", AccountType.EXPENSE),
    ("expense:rent", "Rent and utilities", AccountType.EXPENSE),
    ("expense:other", "Other expenses", AccountType.EXPENSE),
    ("equity:opening", "Opening balances", AccountType.EQUITY),
    ("suspense:unmatched", "Unmatched bank lines", AccountType.SUSPENSE),
]

# (code, name, kind, account code or None)
CATEGORIES: list[tuple[str, str, str, str | None]] = [
    ("rental", "Rental", CategoryKind.INCOME, "income:rental"),
    ("sale", "Sale", CategoryKind.INCOME, "income:sales"),
    ("membership", "Membership fee", CategoryKind.INCOME, "income:membership"),
    ("donation", "Donation", CategoryKind.INCOME, "income:donation"),
    ("tools", "Tools and equipment", CategoryKind.EXPENSE, "expense:tools"),
    ("consumables", "Consumables", CategoryKind.EXPENSE, "expense:consumables"),
    ("repairs", "Repairs and maintenance", CategoryKind.EXPENSE, "expense:repairs"),
    ("food", "Food and catering", CategoryKind.EXPENSE, "expense:food"),
    ("events", "Events", CategoryKind.EXPENSE, "expense:events"),
    ("rent", "Rent and utilities", CategoryKind.EXPENSE, "expense:rent"),
    ("other-expense", "Other expense", CategoryKind.EXPENSE, "expense:other"),
    ("top-up", "Top-up", CategoryKind.TRANSFER, None),
    ("payout", "Payout", CategoryKind.TRANSFER, None),
    ("member-transfer", "Between members", CategoryKind.TRANSFER, None),
    ("shared-expense", "Shared expense", CategoryKind.TRANSFER, None),
    ("correction", "Correction", CategoryKind.TRANSFER, None),
]


def ensure_chart_of_accounts(book: Book) -> None:
    """Create any missing system account, its balance row, and category. Idempotent."""
    accounts = {}
    for code, name, account_type in SYSTEM_ACCOUNTS:
        account, _ = Account.objects.get_or_create(
            book=book, code=code, defaults={"name": name, "type": account_type}
        )
        AccountBalance.objects.get_or_create(account=account)
        accounts[code] = account
    for order, (code, name, kind, account_code) in enumerate(CATEGORIES):
        Category.objects.get_or_create(
            book=book,
            code=code,
            defaults={
                "name": name,
                "kind": kind,
                "account": accounts.get(account_code) if account_code else None,
                "sort_order": order,
            },
        )
