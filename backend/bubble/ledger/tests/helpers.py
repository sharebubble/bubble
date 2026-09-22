import datetime
from decimal import Decimal

from moneyed import Money

TODAY = datetime.date(2026, 9, 1)


def eur(amount) -> Money:
    return Money(Decimal(str(amount)), "EUR")


def display_balance(account) -> Decimal:
    account.balance.refresh_from_db()
    return account.balance.display_balance


def raw_balance(account) -> Decimal:
    account.balance.refresh_from_db()
    return account.balance.balance
