class LedgerError(Exception):
    """Base class for every refusal raised by the ledger service layer."""


class UnbalancedTransactionError(LedgerError):
    """The legs of a transaction do not sum to zero, or there are fewer than two."""


class CurrencyMismatchError(LedgerError):
    """A leg uses a currency other than the book's currency."""


class ClosedPeriodError(LedgerError):
    """The transaction's business date falls inside a closed period."""


class ImmutableLedgerError(LedgerError):
    """Posted transactions and entries can never be changed or deleted."""


class OverReversalError(LedgerError):
    """A reversal or correction would undo more than is left of an entry."""


class NonZeroBalanceError(LedgerError):
    """A member account with a non-zero balance cannot be released."""
