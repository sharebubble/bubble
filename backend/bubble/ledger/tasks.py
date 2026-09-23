import logging

from huey import crontab
from huey.contrib.djhuey import periodic_task

from bubble.ledger.cost_shares import process_cost_share_deadlines
from bubble.ledger.reminders import remind_low_balances
from bubble.ledger.services import verify_ledger

logger = logging.getLogger(__name__)


@periodic_task(crontab(hour="3", minute="30"))
def verify_ledger_nightly() -> None:
    """Check invariants I7 (trial balance is zero) and I8 (cached balances)."""
    result = verify_ledger()
    if result.ok:
        logger.info("Ledger verified: trial balance 0, all cached balances match.")
        return
    # Logged as an error so it reaches Glitchtip; the ledger page shows a banner.
    logger.error(
        "Ledger verification FAILED: trial balance %s, mismatched accounts %s",
        result.trial_balance,
        result.mismatched_accounts,
    )


@periodic_task(crontab(minute="45"))
def process_cost_share_deadlines_hourly() -> None:
    """Hourly: remind silent participants, book splits past their deadline."""
    reminded, posted = process_cost_share_deadlines()
    if reminded or posted:
        logger.info("Shared expenses: %d reminders, %d splits booked", reminded, posted)


@periodic_task(crontab(hour="9", minute="0"))
def remind_low_balances_daily() -> None:
    """Daily: remind members below the soft limit, at most once a week each."""
    sent = remind_low_balances()
    if sent:
        logger.info("Sent %d low-balance reminders", sent)
