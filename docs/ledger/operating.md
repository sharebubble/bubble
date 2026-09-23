# Operating the community ledger

What an admin needs to run the ledger described in [plan.md](plan.md): the
background jobs, the settings, the database role that makes the ledger
append-only in production, and what to do when something looks wrong.

## Who is the treasurer

Treasurer rights (payouts, community income, answering any dispute,
categories and projects, the unbilled list) belong to superusers and to members
of the Django group **`ledger_admin`**. Add or remove people in the Django admin
under *Groups*. Every other member can read everything (plan D8) and post only
what charges their own account.

## Background jobs (huey)

All times are in the server time zone (`TIME_ZONE`, Europe/Vienna). Every job
is idempotent, so a missed or repeated run is harmless.

| Job | When | What it does |
|---|---|---|
| `verify_ledger_nightly` | 03:30 | Trial balance is zero and every cached balance matches its entries (I7, I8). A failure is logged as an error (reaches Glitchtip) and the ledger page shows a red banner. |
| `reconcile_booking_charges_daily` | 04:00 | Finds charged bookings without a ledger charge, and sales still waiting for the buyer after 14 days. |
| `remind_low_balances_daily` | 09:00 | Reminds members below the book's soft limit, at most once a week each (D10). |
| `remind_or_auto_approve_sales_hourly` | minute 15 | Reminds silent buyers once a day and approves accepted sales after `SALE_AUTO_APPROVE_DAYS` (D19). |
| `process_cost_share_deadlines_hourly` | minute 45 | Reminds silent split participants a day before the deadline and books splits past `COST_SHARE_AUTO_ACCEPT_DAYS` (D13). |

The huey consumer must run for any of this to happen; without it nothing is
charged automatically and nobody is reminded.

## Settings

Changed at runtime in the Django admin under *Constance → Config*:

- `SALE_AUTO_APPROVE_DAYS` (default 3): days after a seller accepts a sale until
  it is confirmed and charged automatically.
- `COST_SHARE_AUTO_ACCEPT_DAYS` (default 3): days participants have to answer a
  split before silence counts as acceptance.

On the book itself (Django admin → *Books*): the currency (fixed once used) and
`negative_balance_soft_limit` (default −100.00), below which members are
reminded. Nothing is ever blocked.

## Append-only in production

The ledger rows (`ledger_transaction`, `ledger_entry`, `ledger_receipt`,
`ledger_receiptaccess`, `ledger_transactioncomment`) are protected three times:
the models refuse updates and deletes, `BEFORE UPDATE OR DELETE` triggers refuse
raw SQL (`ledger_forbid_change`), and — in production — the application's
database role should not have the privileges to try. Run migrations with a
separate owner role and grant the app role only what it needs:

```sql
-- as the owner role, after `migrate`
REVOKE UPDATE, DELETE, TRUNCATE ON
    ledger_transaction, ledger_entry, ledger_receipt,
    ledger_receiptaccess, ledger_transactioncomment
FROM bubble_app;
GRANT SELECT, INSERT ON
    ledger_transaction, ledger_entry, ledger_receipt,
    ledger_receiptaccess, ledger_transactioncomment
TO bubble_app;
```

(`bubble_app` stands for whatever role the app connects as.) Tables that hold
mutable state next to the ledger — balances cache, disputes, cost shares,
categories, projects — keep normal privileges. Reversals take an advisory lock
instead of `SELECT … FOR UPDATE`, so they work with these grants.

Test databases are flushed with `TRUNCATE`, which fires no row triggers; that is
why the tests can reset the ledger and production cannot.

## Backups

Receipts are stored in the database (plan section 7), so a normal PostgreSQL
backup contains the complete books, receipts included; there is no separate
media folder to back up for the ledger. If the association has German
bookkeeping duties, keep backups for the 10-year retention period (plan
section 13) and confirm this with the tax advisor.

## When the ledger fails its check

1. Look at the error from `verify_ledger_nightly` (Glitchtip, or run
   `verify_ledger()` in `manage.py shell`): it names the trial balance and the
   accounts whose cached balance differs from their entries.
2. A **cache mismatch** with a zero trial balance means `AccountBalance` drifted
   (e.g. a restore from mismatched backups). The entries are the truth;
   recompute the cache from them in `manage.py shell` and run the check again:

   ```python
   from django.db.models import Count, Max, Sum
   from bubble.ledger.models import AccountBalance, Entry

   for balance in AccountBalance.objects.all():
       row = Entry.objects.filter(account=balance.account_id).aggregate(
           total=Sum("amount"), count=Count("id"), last=Max("transaction__seq")
       )
       balance.balance = row["total"] or 0
       balance.entry_count = row["count"]
       balance.last_seq = row["last"]
       balance.save()
   ```
3. A **non-zero trial balance** means rows were changed or lost outside the app.
   Stop and restore from the last good backup; do not try to "fix" entries by
   hand. Corrections are always new transactions posted through the app.

## Mistakes in the books

Nothing is edited or deleted, not even by admins (the Django admin is read-only
for ledger rows). A wrong transaction is answered in the app: its author, the
members it credits or the treasurer reverse it or correct part of it, and a
member who disagrees disputes it. Both the original and the correction stay
visible and link to each other.
