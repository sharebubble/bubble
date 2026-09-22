import logging

from huey import crontab
from huey.contrib.djhuey import periodic_task

from bubble.ledger.services import verify_ledger

logger = logging.getLogger(__name__)


@periodic_task(crontab(hour="3", minute="30"))
def verify_ledger_nightly() -> None:
    """Check invariants I7 (trial balance is zero) and I8 (cached balances)."""
    result = verify_ledger()
    if result.ok:
        logger.info("Ledger verified: trial balance 0, all cached balances match.")
        return
    # Logged as an error so it reaches Glitchtip; a UI banner follows in phase 2.
    logger.error(
        "Ledger verification FAILED: trial balance %s, mismatched accounts %s",
        result.trial_balance,
        result.mismatched_accounts,
    )
