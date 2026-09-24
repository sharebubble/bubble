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
| `publish_ledger_digest_daily` | 03:45 | Recomputes the hash chain, stores the head as a digest (shown on `/ledger/chain`) and posts it to `LEDGER_DIGEST_APPRISE_URL` if set. A broken chain turns the banner red and the post's title says "CHAIN BROKEN". |
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
- `LEDGER_DIGEST_APPRISE_URL`: where the nightly digest goes, as an Apprise URL
  (e.g. a Rocket.Chat or Matrix room every member can read). Empty: digests are
  only kept in the app. Posting the head somewhere the admins cannot rewrite is what
  makes a quiet database edit detectable.
- `COMMUNITY_IBAN`, `COMMUNITY_ACCOUNT_HOLDER`: shown to members on `/ledger/me`
  next to their payment reference.
- `BANK_AUTO_CONFIRM_REFERENCES` (default off): book incoming bank lines that carry
  a member's payment reference as soon as the file is imported.
- `DATEV_CONSULTANT_NUMBER`, `DATEV_CLIENT_NUMBER`, `DATEV_ACCOUNT_LENGTH`
  (default 4), `DATEV_MEMBER_ACCOUNT`: header values of the DATEV export and the
  account number all member accounts share unless one has its own. Get them from the
  tax advisor.

On the book itself (Django admin → *Books*): the currency (fixed once used) and
`negative_balance_soft_limit` (default −100.00), below which members are
reminded. Nothing is ever blocked.

## Append-only in production

The ledger rows (`ledger_transaction`, `ledger_entry`, `ledger_receipt`,
`ledger_receiptaccess`, `ledger_transactioncomment`, `ledger_transactionseal`,
`ledger_ledgerdigest`) are protected three times:
the models refuse updates and deletes, `BEFORE UPDATE OR DELETE` triggers refuse
raw SQL (`ledger_forbid_change`), and — in production — the application's
database role should not have the privileges to try. Run migrations with a
separate owner role and grant the app role only what it needs:

```sql
-- as the owner role, after `migrate`
REVOKE UPDATE, DELETE, TRUNCATE ON
    ledger_transaction, ledger_entry, ledger_receipt,
    ledger_receiptaccess, ledger_transactioncomment,
    ledger_transactionseal, ledger_ledgerdigest
FROM bubble_app;
GRANT SELECT, INSERT ON
    ledger_transaction, ledger_entry, ledger_receipt,
    ledger_receiptaccess, ledger_transactioncomment,
    ledger_transactionseal, ledger_ledgerdigest
TO bubble_app;
```

(`bubble_app` stands for whatever role the app connects as.) Tables that hold
mutable state next to the ledger — balances cache, disputes, cost shares,
categories, projects, periods, bank lines — keep normal privileges. Reversals take an advisory lock
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

## Bank statements

The treasurer downloads the account statement from online banking as **CAMT.053**
(XML, preferred) or CSV and uploads it on `/ledger/bank`. Overlapping downloads are
fine: lines already imported are skipped. For each line the page proposes a member
(by payment reference, a known IBAN or a similar name) or an entry someone already
posted by hand; the treasurer books, matches, parks or ignores it. When nothing is
left to review, "Bank in the books" should equal the balance in online banking;
if it does not, a line was ignored that should have been booked, or something was
posted "via bank" by hand without a matching bank line.

No bank is connected directly yet (plan D11). Members should always put their
payment reference (`BUB-…`, on `/ledger/me`) into the transfer text.

## Closing a period and the tax advisor

On `/ledger/manage` the treasurer closes a period (usually the past year) once all
of its bank lines and shared costs are settled. Closing cannot be undone: nothing
can be booked with a date inside it afterwards, and late items are booked in the
open period. The page stores the SHA-256 of the period's journal, so the journal
file handed over can be checked later against the hash shown there.

Before the first DATEV export, enter the DATEV account number of every account in
the table on the same page and the DATEV settings above; the export names any
account that is still missing one. Have the tax advisor test-import the first file:
the format follows DATEV's EXTF specification but has not yet been checked against
a real DATEV import.

## When the hash chain breaks

The digest and `/ledger/chain` say that the chain is broken; to find where, run
`verify_chain(Book.objects.default())` from `bubble.ledger.chain` in
`manage.py shell`: `broken_at` is the first position whose seal no longer matches. Something changed that row, or one before it, outside the app (the
append-only triggers stop the app itself). Compare the row with the last backup
from before the digest that still said "intact", restore if needed, and treat it as
a security incident: the database was written to by someone with superuser rights.

## Mistakes in the books

Nothing is edited or deleted, not even by admins (the Django admin is read-only
for ledger rows). A wrong transaction is answered in the app: its author, the
members it credits or the treasurer reverse it or correct part of it, and a
member who disagrees disputes it. Both the original and the correction stay
visible and link to each other.
