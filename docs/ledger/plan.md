# Ledger — bookkeeping and accounting for Bubble

Status: **phases 1–5 implemented** (`backend/bubble/ledger/`, `backend/bubble/bookings/services.py`, `frontend/src/pages/Ledger*.tsx`); phase 6 is design.
Scope: a transparent, append-only double-entry ledger for one community, covering
booking charges, member-entered expenses with receipts, top-ups, disputes,
grouping and statistics.

---

## 1. Decisions

These were settled up front; the rest of the document follows from them.

| # | Decision | Choice |
|---|----------|--------|
| D1 | What a balance means | Real euros. Members may go negative. Top-ups are transactions (manual first, bank-detected later). |
| D2 | Who may post manual transactions | Any member, posted immediately, disputable by anyone — **as long as the only member account charged is their own**. Charging anyone else goes through D13. |
| D3 | Ledger core | Double-entry, append-only. No edits, no deletes; corrections are reversals. |
| D4 | Rental counterparty | Per item: earnings go to the item owner or to the community, declared on the item. |
| D5 | Book scope | One implicit book in the UI, but `book` FK on accounts/transactions from migration 0001. |
| D6 | Booking posting trigger | On `COMPLETED`. Cancelled bookings never touch the ledger. |
| D7 | Analytics dimensions | Category (chart of accounts) + project/cost centre + per-item and per-member rollups. |
| D8 | Transparency | Amounts, counterparties and balances visible to every logged-in member. Receipts behind an authenticated, non-guessable, access-logged endpoint. |
| D9 | Disputes | Flag marks the transaction contested and notifies the author; author or admin posts a linked reversal. The original row is never modified. |
| D10 | Negative balances | Soft threshold with warnings and reminders. Nothing is blocked. |
| D11 | Bank top-up detection | Interface decision deferred. Build the import pipeline as a port with a pluggable adapter. |
| D12 | Reporting | Per-member yearly statement, treasurer's annual report, DATEV/CSV bookkeeping export. |
| D13 | Charging other members (shared costs) | Participants are notified and can accept or object; silence counts as acceptance after N days (default 3), then it posts. Only then does it touch the ledger (section 7a). |
| D14 | Which bookings create charges | Only items with the existing `Item.payment_enabled = True`. Nothing changes for existing items on rollout day. |
| D15 | Sales | Sales post too: buyer → seller (or → community for community-owned items), same rules as rentals — when the buyer approves the hand-over, see D17/D18. |
| D16 | Community-owned items | The lister stays the steward (`Item.user`); `ledger_beneficiary = COMMUNITY` marks community ownership and routes income. No system user. |
| D17 | When a sold item changes hands | Ownership moves to the buyer **when the seller accepts the amount** (the sale booking becomes `CONFIRMED`), not at the physical hand-over. The item becomes a `DRAFT` owned by the buyer, who reviews and republishes it. The agreed amount is frozen on the booking at that moment. Supersedes the "on `COMPLETED`" part of D6 for sales (section 6). |
| D18 | Cancelling an accepted sale | Once the seller has accepted, the seller can no longer cancel. The buyer either **approves the fulfilment** (confirms receipt: the booking completes and the frozen amount is charged) or **rejects it** with a reason (not handed over, not as described): the booking is cancelled, the item goes back to the seller as a `DRAFT`, and nothing is charged. |
| D19 | A buyer who never answers | An accepted sale is **approved automatically 3 days** after acceptance (Constance `SALE_AUTO_APPROVE_DAYS`) and charged, exactly as if the buyer had confirmed receipt. Until then the buyer gets **one reminder a day** saying when it will happen and how to report a problem instead. |

Deferred, on purpose: which bank interface (CAMT.053/MT940 upload, PSD2 aggregator,
FinTS/EBICS, CSV). Section 12 defines the seam so the choice stays a plug-in.

---

## 2. Why double-entry, in one paragraph

A community ledger has exactly one property that earns trust: *the money adds up*.
Single-entry rows (`user + amount`) cannot express "Alice is owed 50 € **because**
the community spent 50 € on tools" — the two halves live in different places and can
drift. With double-entry, every transaction is a set of entries whose signed amounts
sum to zero, so at any moment the sum of **all** account balances in the book is zero.
That single invariant is checkable by a nightly job, displayable in the UI, and
impossible to satisfy accidentally after a bug. It is the technical basis of the
social claim "nobody can quietly change your balance".

---

## 3. Sign convention (read this before writing any code)

Entries carry one **signed** amount. The convention is **debit-positive**:

- `amount > 0` — debit: assets and expenses increase, liabilities decrease.
- `amount < 0` — credit: liabilities and income increase, assets decrease.
- **Every transaction sums to exactly 0.**

Member accounts are **liabilities** of the community towards the member, so a member
who is owed money has a *negative raw* balance. Nobody wants to read that in a UI, so
every account has a **normal side**, derived from its type, and the API exposes a
display balance flipped accordingly:

```python
class NormalSide(models.IntegerChoices):
    DEBIT = 1    # ASSET, EXPENSE   — raw balance is already the readable one
    CREDIT = -1  # MEMBER, INCOME, EQUITY, SUSPENSE — raw balance needs flipping

# on Account, derived from `type`, stored so exports and SQL can use it directly:
normal_side = IntegerField(choices=NormalSide)

display_balance = raw_balance * account.normal_side
```

A member's display balance is therefore **positive when the community owes them** and
**negative when they owe the community**, which is what the user expects.

### Worked examples

**(a) Alice buys a 50 € drill for the workshop** (manual transaction, receipt attached)

| Account | Raw amount | Meaning |
|---|---:|---|
| `expense:tools` | +50.00 | the community consumed 50 € of value |
| `member:alice` | −50.00 | the community now owes Alice 50 € |

Alice's display balance: **+50 €**. The community's net position drops by 50 €.

**(b) Bob rents the community drill for 3 days, 10 €** (posted when the booking completes)

| Account | Raw amount |
|---|---:|
| `member:bob` | +10.00 |
| `income:rental` | −10.00 |

Bob's display balance: **−10 €**.

**(c) Bob rents Carla's private trailer for 20 €** (item beneficiary = owner, D4)

| Account | Raw amount |
|---|---:|
| `member:bob` | +20.00 |
| `member:carla` | −20.00 |

No community involvement; member-to-member claim, netted through the same ledger.

**(d) Bob transfers 30 € to the association's bank account** (top-up)

| Account | Raw amount |
|---|---:|
| `asset:bank` | +30.00 |
| `member:bob` | −30.00 |

**(e) The community pays Alice back 50 €** (payout)

| Account | Raw amount |
|---|---:|
| `member:alice` | +50.00 |
| `asset:bank` | −50.00 |

**(f) The drill entry was wrong** (dispute upheld, D9)

A **reversal** transaction with the mirrored entries and `reverses = <original>`.
Both rows stay visible forever, linked in both directions.

**(g) Alice cooks for four and splits the 60 € shopping bill** (shared expense, D13)

Alice, Bob, Carla and Dan eat; equal split, 15 € each. Alice's own share is simply not
charged — the community accounts are not involved at all:

| Account | Raw amount |
|---|---:|
| `member:bob` | +15.00 |
| `member:carla` | +15.00 |
| `member:dan` | +15.00 |
| `member:alice` | −45.00 |

Alice's display balance: **+45 €**; Bob, Carla, Dan: **−15 €** each. If instead the
dinner is a community event paid from the pot, it is plain example (a) with an
`expense:food` category and a project.

**(h) Dan disputes only his share after it posted**

A **correction** mirrors a *subset* of the original legs, still balanced:
`member:dan` −15.00 / `member:alice` +15.00, with `reverses = <original>` and
`kind = CORRECTION`. Bob's and Carla's shares stand.

---

## 4. Data model

New Django app `backend/bubble/ledger/`, following house conventions: UUID PKs,
`gettext_lazy` on user-facing strings, `MoneyField` from `django-money`, guardian for
object permissions where needed, `get_for_user` managers on anything scoped.

`simple-history` is deliberately **not** used on `Transaction`/`Entry` — those rows are
immutable, so a history table would only add write cost. It *is* used on `Dispute`,
`Project` and `Item.ledger_beneficiary`, which are mutable.

```python
class Book(models.Model):
    """One community's set of accounts. Single row for now (D5)."""
    id, slug, name
    currency = CharField(3, default=settings.DEFAULT_CURRENCY)
    opened_on = DateField()
    negative_balance_soft_limit = DecimalField(default=-100)   # D10, in the book's currency

class AccountType(IntegerChoices):
    MEMBER = 1      # liability towards a member
    ASSET = 2       # bank, cash
    INCOME = 3
    EXPENSE = 4
    EQUITY = 5      # opening balances, community net position
    SUSPENSE = 6    # unmatched bank lines

class Account(models.Model):
    id, book(FK), type, code, name, is_active
    normal_side = IntegerField(choices=NormalSide)   # derived from type, section 3
    owner = FK(User, null=True, on_delete=SET_NULL)  # only for MEMBER accounts; see section 14
    # unique_together: (book, code); code is stable and export-safe
    # code examples: member:<user-uuid>, asset:bank, income:rental, expense:tools

class TransactionKind(IntegerChoices):
    BOOKING_CHARGE,    # rental or sale, see section 6
    MEMBER_EXPENSE, SHARED_EXPENSE, TOP_UP, PAYOUT,
    MEMBERSHIP_FEE, ADJUSTMENT, OPENING_BALANCE,
    REVERSAL,          # mirrors every leg of the original
    CORRECTION,        # mirrors a subset of legs (e.g. one participant's share)

class Transaction(models.Model):
    id = UUIDField(primary_key=True)
    book = FK(Book, on_delete=PROTECT)
    # Stable global ordering, independent of created_at collisions. A plain
    # BigIntegerField fed by a Postgres sequence created in the migration
    # (db_default=Func("ledger_transaction_seq", function="nextval")) — not a
    # BigAutoField, which Django only allows as the primary key.
    seq = BigIntegerField(editable=False)
    kind, occurred_on = DateField()               # business date
    created_at, created_by = FK(Account, null=True, on_delete=PROTECT)  # author's member
    # account, not the user: a member leaving never has to touch an immutable row.
    # Null = posted by the system (e.g. a booking completing).
    description = TextField()
    category = FK(Category, on_delete=PROTECT, null=True)   # D7
    project  = FK(Project,  on_delete=PROTECT, null=True)   # D7
    source_type, source_id                        # 'booking' + Booking.id, 'statement_line' + id
    idempotency_key = CharField(blank=True)       # e.g. "booking:<uuid>:charge"
    reverses = FK("self", null=True, related_name="reversed_by")  # REVERSAL or CORRECTION
    prev_hash, hash = CharField(64, blank=True)   # phase 6, section 11

    class Meta:
        constraints = [
            UniqueConstraint(fields=["book", "idempotency_key"],
                             condition=~Q(idempotency_key=""),
                             name="ledger_transaction_idempotency_key_per_book"),
            UniqueConstraint(fields=["book", "seq"], name="ledger_transaction_seq_per_book"),
        ]

class Entry(models.Model):
    id, transaction(FK, related_name="entries"), account(FK, on_delete=PROTECT)
    amount = MoneyField(max_digits=12, decimal_places=2)   # signed, debit-positive
    item = FK(Item, null=True, on_delete=DO_NOTHING, db_constraint=False)
    # per-item analytics (D7); no DB constraint, so deleting an item never rewrites
    # an immutable entry. The id stays for analytics after the item is gone.
    reverses_entry = FK("self", null=True)   # reversal legs point at what they undo;
    # the service refuses to undo more of an entry than is left (section 7a, example h)
    memo = CharField(blank=True)

class Receipt(ImmutableModel):             # append-only, bytes in the DB (section 7)
    id, transaction(FK), uploaded_by(FK Account), uploaded_at
    file_name, content_type (sniffed), size, sha256, content = BinaryField()

class ReceiptAccess(ImmutableModel):       # D8 — who opened which receipt, when
    receipt(FK), accessed_by(FK Account), accessed_at

class DisputeState(IntegerChoices):
    OPEN, WITHDRAWN, RESOLVED_REVERSED, RESOLVED_UPHELD

class Dispute(models.Model):                # D9 — the mutable part, kept out of the ledger rows
    id, transaction(FK), raised_by, reason, state,
    resolved_by, resolved_at, resolution_note,
    resolving_transaction = FK(Transaction, null=True)
    history = HistoricalRecords()

class Category(models.Model):               # chart of accounts, seeded by data migration
    id, book, code, name, kind (income|expense|transfer), account = FK(Account), sort_order

class Project(models.Model):                # cost centre (D7)
    id, book, name, slug, budget (nullable), starts_on, ends_on, is_archived
    history = HistoricalRecords()

class AccountBalance(models.Model):         # cache, section 8
    account = OneToOne(Account), balance, entry_count, last_seq, updated_at

class LedgerPeriod(models.Model):           # period close, needed once exports exist (D12)
    book, starts_on, ends_on, closed_at, closed_by, export_hash
```

### Item changes

`Item` already has an unused `payment_enabled` boolean ("Enable payment via internal
payment system"). It becomes the **opt-in for ledger charges** (D14): bookings of items
with `payment_enabled = False` never post, whatever their price. It gains one field
(D4, D16):

```python
class LedgerBeneficiary(TextChoices):
    OWNER = "owner"          # income credits the steward (Item.user)
    COMMUNITY = "community"  # the community owns the item; income credits the pot

ledger_beneficiary = CharField(choices=LedgerBeneficiary, default=OWNER)
```

`Item.user` keeps its meaning of *steward* — the person who looks after the item and
handles bookings. `COMMUNITY` means the community owns it (D16); the UI shows "owned by
the community, looked after by Alice". No system user is created. The migration sets
`OWNER` everywhere; switching to `COMMUNITY` is done by admins (it hands an asset to
the community, so not something a steward toggles alone). Co-owners with guardian
`change_item` permission do not share income; the credit leg is always `Item.user` or
the community.

---

## 5. Invariants and where they are enforced

| ID | Invariant | Enforcement |
|----|-----------|-------------|
| I1 | Entries of a transaction sum to zero | Postgres `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` added via `RunSQL`, checked at commit — the service layer can build a transaction incrementally, but the database refuses an unbalanced commit. Mirrored by a service-level assertion for a clear error message. |
| I2 | ≥ 2 entries per transaction | same trigger |
| I3 | All entries use the book's currency | denormalised `currency` on `Entry` + trigger comparing to `book.currency` |
| I4 | Rows are append-only | `Transaction.save()`/`Entry.save()` raise on update; `delete()` and queryset `update()`/`delete()` raise; a `BEFORE UPDATE OR DELETE` trigger refuses raw SQL too (TRUNCATE, used to flush test databases, fires no row triggers). In production the app DB role is granted only `INSERT`/`SELECT` on these tables (migrations run as a separate role) — to be documented in `docs/ledger/operating.md`, written alongside phase 1. |
| I5 | No double posting from the same source | `UniqueConstraint(book, idempotency_key)` |
| I6 | No posting into a closed period | service check against `LedgerPeriod` |
| I7 | Trial balance: sum of all account balances = 0 | nightly huey task `verify_ledger_nightly` (03:30, logs an error on failure so it reaches Glitchtip); result exposed at `/api/ledger/health/` and shown in the UI (section 11) |
| I8 | Cached balance = recomputed sum | same nightly task, per account |

The **only** way to write to the ledger is `bubble.ledger.services.post_transaction()`.
Nothing else — no viewset, no signal handler, no admin action — constructs `Entry`
objects. A test asserts that no module outside `ledger/services.py` imports `Entry`.

```python
def post_transaction(*, book, kind, occurred_on, description, legs,
                     created_by, category=None, project=None,
                     source=None, idempotency_key=None) -> Transaction:
    """Atomically write a balanced transaction and update cached balances.

    legs: list of (account, Money, item|None, memo)
    Locks the touched AccountBalance rows in account-id order (deadlock-free),
    validates the period is open and the currency matches, then inserts.
    Idempotent: returns the existing transaction if idempotency_key is taken.
    """
```

---

## 6. Booking integration (D6, D14, D15, D17, D18)

Posting happens **when a booking transitions to `COMPLETED`**, in the same
`transaction.atomic()` block as the status change, through an explicit service call —
not a `post_save` signal, so the posting cannot fire on unrelated saves and is easy to
follow when reading the booking code. For rentals that transition lives in
`BookingViewSet.confirm_returned` (and the owner ending a self-service rental). Sales are
agreed at acceptance and post when the buyer approves the hand-over (D17/D18, below).

**Sales follow D17 and D18, not D6.** A sale is agreed when the seller accepts the
amount, and paid when the buyer approves the hand-over:

- **Acceptance** (the booking of a `SELL` or `DONATE` item enters `CONFIRMED`: the owner
  accepts via PATCH `status`, or `perform_create` auto-confirms a self-service request
  at or above the price). One service, `bookings.services.accept_sale(booking)`, runs in
  the same `transaction.atomic()`:
  - it **freezes the terms** on the booking: `seller` (the steward at that moment),
    `sale_accepted_at`, `agreed_price` (counter-offer → offer → item price) and
    `credit_community` (the item's beneficiary). These are read **before** the transfer:
    afterwards the buyer owns the item and could change its price or beneficiary;
  - it **moves ownership**: `item.transfer_ownership(buyer)` — a `DRAFT` owned by the
    buyer, fresh permissions, `local_only` federation, no publish notification, and
    `ledger_beneficiary` back to `OWNER` (the buyer owns it privately);
  - it **rejects other pending requests** for the item, which is no longer the
    seller's to sell;
  - **nothing posts yet.** The booking's `ledger_state` becomes `pending` (or
    `not_charged` when payments are off or the amount is zero).
- **The seller cannot cancel** an accepted sale (D18). PATCHing the status of an
  accepted sale is refused for both sides; the buyer's two actions below are the only
  ways forward.
- **Buyer approves** (`confirm_received`): the booking completes and the charge posts,
  buyer → seller (or → `income:sales` when `credit_community`), idempotency key
  `booking:<id>:charge`, amount = the frozen `agreed_price`.
- **Buyer rejects** (`reject_fulfillment`, with a reason: not handed over, not as
  described): the booking is cancelled, the item goes back to the seller as a `DRAFT`
  (and back to the community if it was a community item), and nothing is charged. The
  reason is recorded as a booking message. If the buyer has already passed the item on
  (a later booking of it is confirmed or in progress), rejection is refused.
- **Donations** take the same path; they never charge.
- **Visibility:** `Booking.objects.get_for_user` used to find the seller's bookings only
  through their `change_item` permission, which moves to the buyer at acceptance; it
  now also matches `seller`, so the conversation keeps working after the transfer.
- **Remote buyers** (`booking.user is None`): there is no local account to own the
  item, so ownership stays with the seller until a cross-instance transfer is designed
  (section 17, question 2); acceptance just confirms the booking, as before.
- **Sales accepted before phase 3** have no `seller` recorded. They keep the old flow:
  ownership moves at `confirm_received`, and nothing is charged.
- **The buyer does not answer (D19):** an hourly huey task sends the buyer one reminder
  per day after acceptance (notification + in-app message, naming the date of the
  automatic approval), and **approves the sale automatically once
  `SALE_AUTO_APPROVE_DAYS` (default 3) have passed**: the booking completes and the
  frozen amount is charged, with a booking message saying it happened automatically.
  `Booking.sale_reminders_sent` makes the reminders idempotent. The reconciliation job
  still lists sales waiting longer than 14 days, which now only happens if the task
  stopped running.
- **After completion**, a refund is an ordinary correction by the seller, and the item
  stays with the buyer unless they sell or give it back.

**Amount precedence:** accepted `counter_offer` → `offer` → `Booking.rental_price`
(rentals; an open-ended rental is priced up to the moment it is returned) or `Item.price`
(sales, frozen at acceptance). Rentals are priced when they complete.
The chosen amount and its source are written into the transaction description and a
structured `meta` field, so the charge stays explainable even if the item's price
changes later. Price is *never* recomputed from the item after posting.

**Beneficiary:** `item.ledger_beneficiary` decides whether the credit leg is
`member:<owner>` or `income:rental` (community).

**Skip rules — no transaction at all when:**
- the item has `payment_enabled = False` (D14),
- the amount is zero or null (borrow / donate / free items),
- the booker is the item's own steward (booking their own item).

**Unbilled — should be charged, but cannot be:** the booker is a remote federated actor
(`booking.user is None`, no local account), the price is in another currency than the
book, or the seller's account no longer exists. These bookings are listed in the
treasurer's "unbilled" view (`GET /api/ledger/unbilled/`) with the reason. Cross-instance
settlement is explicitly out of scope for v1 and needs its own design.

**Booking ledger state:** every evaluated booking records `ledger_state` — `pending`
(accepted sale waiting for the buyer), `posted`, `not_charged` (with the reason in
`ledger_note`) or `unbilled` — so the booking page can show what happened and the
reconciliation job has something to check. Bookings from before phase 3 stay blank.

**Idempotency key:** `booking:<booking-id>:charge` (rentals and sales alike). Two concurrent completions produce
one posting; the second call returns the existing transaction.

**Reconciliation job:** a daily huey periodic task checks that every `posted` booking has
its transaction and every booking charge belongs to a `posted` booking, and lists
unbilled bookings and sales awaiting the buyer for more than 14 days. Belt and braces
against a missed transition.

**Late cancellation of a completed booking** is a reversal, like any other correction.

---

## 7. Manual transactions and receipts (D2, D8)

The API does **not** accept raw entry lists in v1. It accepts an intent, and the
service expands it into legs. That keeps unbalanced or nonsensical postings
unrepresentable from the outside:

| Intent | Legs produced |
|---|---|
| `expense_for_community` (the drill) | `expense:<category>` +X / `member:<me>` −X |
| `top_up` | `asset:bank` or `asset:cash` +X / `member:<me>` −X |
| `payout` (admin) | `member:<target>` +X / `asset:bank` −X |
| `member_to_member` (I owe someone) | `member:<me>` +X / `member:<to>` −X |
| `shared_expense` (section 7a) | one +share leg per participant / `member:<payer>` −sum |
| `income` (donation, fee) | `asset:*` +X / `income:*` −X |

**Rule (D2/D13): a direct post may only charge the poster's own member account.**
Anything that puts a charge on someone else's account — a split dinner, "Bob owes me
for the tickets" — is a `shared_expense` and goes through the confirmation flow in 7a.
Admin payouts and adjustments are the exception.

Every transaction carries a category and allows an optional project. Members pick
the category for `expense_for_community` (an expense category) and the treasurer for
`income` (an income category); the other intents use a fixed category (`top-up`,
`payout`, `member-transfer`). Receipt upload is optional but strongly nudged in the UI
for `expense_for_community` — the transaction list shows a "no receipt" marker, which
is a social signal, not a block.

As implemented in phase 2 (`bubble/ledger/intents.py`): `member_to_member` posts as the
new kind `MEMBER_TRANSFER`, `income` as `INCOME`; `top_up`, `payout` and `income` take
`via = bank | cash`. Amounts are positive, whole cents, at most 100 000; the date may
not lie in the future. The form sends a random `client_key`, stored as the
idempotency key `manual:<author account>:<key>`, so a double submit posts once. The
`ledger_admin` group (the treasurer, seeded by migration 0003; superusers count too)
may post `payout` and `income`; for everyone else those are a 403.

**Receipts** are stored **in the database** (`Receipt.content`), not on media storage.
Media is served publicly by nginx on every deployment (compose and Helm) and may sit
in a public S3 bucket, so "private storage" would have needed a new volume or bucket
per deployment. In the database, receipts are private by construction, backed up with
the books they document, and protected by the same append-only trigger as the ledger
rows. Limits: 10 MB and 5 receipts per transaction; the content type is sniffed from
the file (PDF, JPEG, PNG, WebP, HEIC), never taken from the client. They are served
by `GET /api/ledger/receipts/{id}/file/` for authenticated members only, with
`Content-Disposition: attachment`, `nosniff`, `no-store` and a sandbox CSP, and every
download writes an append-only `ReceiptAccess` row (visible in the admin). The
SHA-256 of each file is shown on the transaction, so a receipt cannot be silently
swapped. The author (or the treasurer) may add receipts later
(`POST /api/ledger/transactions/{id}/receipts/`); nobody can replace or remove one.
If receipt volume ever makes the database uncomfortable, a data migration can move
the bytes to a private bucket behind the same endpoint; the API does not change.

---

## 7a. Shared expenses: charging other members (D13)

The ledger is append-only, so a split that waits for people to confirm cannot live in
it. It lives in a mutable **`CostShare`** until it is final, then posts one
`SHARED_EXPENSE` transaction — the same pattern as bank `MatchProposal`s (section 12).

```python
class CostShareState(IntegerChoices):
    OPEN, POSTED, CANCELLED

class CostShare(models.Model):
    id, book, payer = FK(User), created_by = FK(User)
    total = MoneyField(), description, occurred_on, category, project (nullable)
    split = CharField(choices=["equal", "weights", "amounts"])
    payer_participates = BooleanField(default=True)
    auto_accept_at = DateTimeField()           # created_at + N days (Constance, default 3)
    state, posted_transaction = FK(Transaction, null=True)
    receipts                                   # same Receipt model: phase 4 adds a nullable
                                               # Receipt.cost_share FK (exactly one of
                                               # transaction/cost_share), since receipts are
                                               # append-only and cannot be re-pointed later
    history = HistoricalRecords()

class CostShareParticipant(models.Model):
    cost_share = FK(CostShare), user = FK(User)
    weight = DecimalField(default=1)           # "weights" split, e.g. 0.5 for a child
    amount = MoneyField(null=True)             # "amounts" split
    guests = PositiveSmallIntegerField(default=0)   # non-members this person brought
    response = IntegerChoices(PENDING, ACCEPTED, OBJECTED)
    responded_at, objection_reason
```

**Lifecycle**

1. The payer creates it; every participant is notified with their exact share.
2. Each participant accepts or objects. An objection removes that person's share and
   notifies the payer, who can edit the split (re-notifying the affected people) or
   cancel it. Nobody else's share changes without them being told.
3. When everyone has answered, or `auto_accept_at` passes (huey periodic task), all
   still-pending participants count as accepted and the split posts **one**
   transaction, idempotency key `cost_share:<id>`. From then on it is ordinary ledger
   data: visible to all, disputable, correctable.
4. After posting, a participant disputing their share gets a **partial correction**
   (example h) — only their legs are mirrored. The service refuses a correction that
   would reverse more than the original leg.

**Guests** (no account) are charged to the member who brought them: `guests = 2`
means that participant carries three shares. **The payer** normally eats too
(`payer_participates`); their own share is computed but never posted.

**Rounding.** Shares are computed exactly, floored to the cent, and the leftover cents
go to the largest fractional remainders, ties broken by stable participant order
(largest-remainder method), so the shares always add up to exactly the total. The
payer is credited exactly the sum of the shares actually posted (their own excluded),
so the transaction balances by construction. The same helper rounds rental prices, so
there is one rounding rule in the codebase.

**As built (phase 4).** The models live in `bubble/ledger/models.py` with the payer
and participants as member *accounts* rather than users (like every other ledger
reference), the service in `bubble/ledger/cost_shares.py`, and the job
`process_cost_share_deadlines_hourly`, which also sends the one reminder a pending
participant gets a day before the deadline (`COST_SHARE_AUTO_ACCEPT_DAYS`, default 3).
The payer is listed last in the rounding, so leftover cents go to participants first.
An objected share keeps its computed value on the split page (struck through) but is
not posted; if every participant objects, the split is cancelled instead of posted.
Editing an open split replaces its participants and asks everyone again. The posted
transaction's detail page shows the split's receipts and links back to the split
(`/ledger/splits/<id>`).

**Disputes, comments and corrections (phase 4).** `Dispute` (one open dispute per
member and transaction) and the append-only `TransactionComment` live next to the
transaction; the service is `bubble/ledger/disputes.py`. The transaction's author,
the members it *credits* (they give money back) and the treasurer may reverse it,
correct part of it (the UI takes positive amounts per line and requires both sides to
balance; the sign follows what is left of each line) or keep it with an explanation.
A reversal or correction closes the open disputes on it. Reversals and corrections
themselves are not reversed again; a mistake in one is fixed with a new entry.

**Notifications (phase 4).** One new event type, `ledger`, joins the "messages"
group of the notification settings (existing preferences are copied from "new
messages", and new users get it on RocketChat by default). `bubble/ledger/notify.py`
sends each notice after the database transaction commits, as an in-app message and on
the member's channels, in the member's language: postings that change a member's
balance (not to the person who posted), disputes, answers, comments, split requests,
changes, reminders and objections, the weekly soft-limit reminder
(`remind_low_balances_daily`, at most once a week while below the limit), and the sale
reminders and automatic confirmation of D19.

**Why not just `Project`?** Projects are cost centres ("Thursday dinners", "summer
festival") for grouping and budgets. A `CostShare` is one concrete event with
participants. A CostShare can belong to a project, which is how "what did the Thursday
dinners cost this year" works.

---

## 8. Balances and performance

Balances are **derived**, but cached: `AccountBalance` is updated inside the same DB
transaction as the posting, under `SELECT … FOR UPDATE` on the affected rows ordered by
account id (deterministic order → no deadlocks). Reads are then O(1).

The nightly `verify_ledger` task recomputes every account from `Entry` and compares
(I8), plus the trial balance (I7). Any mismatch pages the admins and shows a banner —
a ledger that silently disagrees with itself is worse than one that says so.

Indexes: `Entry(account, transaction)`, `Entry(item)`, `Transaction(book, occurred_on)`,
`Transaction(category)`, `Transaction(project)`, `Transaction(kind)`, plus the unique
constraints on `(book, idempotency_key)` and `(book, seq)`.

For statistics at scale, a `LedgerMonthlyRollup(book, account, category, project, month,
amount, entry_count)` table maintained by a huey periodic task. Because the ledger is
append-only, rollups only ever need rows added for months that received new postings —
no invalidation logic. Ship rollups only when live aggregates get slow; the plain
aggregate query is fine for a few tens of thousands of entries.

---

## 9. API

DRF viewsets under `/api/ledger/`, documented through drf-spectacular, consumed via the
generated SDK (`npm run types:openapi`).

```
GET    /api/ledger/transactions/            list, all members (D8)
                                            filters: member, account, category, project,
                                            item, kind, date_from, date_to, has_receipt,
                                            disputed, q
POST   /api/ledger/transactions/            manual intent (section 7)
GET    /api/ledger/transactions/{id}/       entries, receipts, dispute, reversal links
POST   /api/ledger/transactions/{id}/reverse/     author, credited member or admin
POST   /api/ledger/transactions/{id}/correct/     same; {lines: [{entry, amount}]}
POST   /api/ledger/transactions/{id}/dispute/     any member (D9)
POST   /api/ledger/transactions/{id}/comments/    discussion thread
POST   /api/ledger/disputes/{id}/withdraw/        the member who raised it
POST   /api/ledger/disputes/{id}/uphold/          keep it, with a resolution

GET    /api/ledger/accounts/                chart of accounts; ?type=member lists every
                                            member's balance (transparent, D8)
GET    /api/ledger/accounts/me/             my account + balance + soft-limit state
GET    /api/ledger/accounts/{id}/entries/   statement with the balance after each entry
POST   /api/ledger/transactions/{id}/receipts/    add a receipt (author or treasurer)

POST   /api/ledger/splits/                  create a shared expense (section 7a)
GET    /api/ledger/splits/?mine=1           splits I paid for or take part in;
                                            ?waiting_for_me=1, ?state=open
PUT    /api/ledger/splits/{id}/             payer edits while OPEN (re-notifies)
POST   /api/ledger/splits/{id}/accept/      participant
POST   /api/ledger/splits/{id}/object/      participant, with reason
POST   /api/ledger/splits/{id}/cancel/      payer or admin, while OPEN
POST   /api/ledger/splits/{id}/receipts/    payer adds a receipt

GET    /api/ledger/stats/?group_by=category|project|month|member|item|kind
                                            &date_from=&date_to=&category=&project=
GET    /api/ledger/categories/              read for all; POST/PATCH treasurer
GET    /api/ledger/projects/                read for all; POST/PATCH treasurer
                                            (?include_hidden=true: retired/archived)

GET    /api/ledger/receipts/{id}/file/      authenticated, logged (D8)

GET    /api/ledger/accounts/{id}/statement/?date_from=&date_to=   statement (D12)
GET    /api/ledger/accounts/{id}/statement/csv/                    same, as CSV
GET    /api/ledger/reports/annual/?year=2026    treasurer's report (D12)
GET    /api/ledger/reports/annual/csv/?year=    same, as CSV
GET    /api/ledger/exports/datev/?from=&to=     bookkeeping export, admin only (D12)
GET    /api/ledger/health/                      trial balance + cache check (ok flag)
```

Phase 2 ships the transactions list/detail/create, receipts, accounts (with `me` and
`entries`), categories, projects (read-only) and health. Amounts are decimal strings;
entries carry both the raw debit-positive `amount` and `display_amount`, the effect
on that account's readable balance.

**Permissions.** Read: any authenticated user, everything (D8). Write: members may post
manual transactions that charge only their own account, create cost shares, answer
the ones they take part in, dispute and comment on anything, and reverse or correct
transactions **they authored or that credit them** (giving money back). A `ledger_admin` group (treasurer) may post payouts and adjustments, reverse
anyone's transaction, manage categories/projects, close periods and run exports. Nothing
is deletable by anyone, including admins and the Django admin — the admin registers the
models read-only.

---

## 10. Frontend

Pages (Mantine, per house rules — no shadcn, styling in `src/theme/mantine.ts`):

- **`/ledger`** — the community feed. Every transaction, newest first, with amount,
  both sides, category chip, project chip, receipt icon, dispute badge, and a
  "posted automatically from booking X" vs "entered by Alice" provenance line. Filters
  in a drawer; the filter state lives in the URL so views are shareable.
- **`/ledger/t/{id}`** — detail: entries table, receipt viewer, comment thread, dispute
  and reverse actions, and links to the reversal or the reversed original.
- **`/ledger/me`** — my account: current balance in plain language ("the community owes
  you 50 €"), soft-limit warning when applicable, running-balance list, statement
  download. `/ledger/a/{id}` shows any other account the same way, and a "Balances"
  tab on `/ledger` lists every member's balance.
- **My balance everywhere** — the balance card (with the plain-language sentence) sits at
  the top of the account hub (`/account`, the mobile entry point), and the avatar
  menu in the header shows "My balance" with the signed amount.
- **`/ledger/stats`** — grouped views: by category, by project (with budget progress),
  by member, by item, by month. Charts kept minimal and readable.
- **New transaction** — modal with intent selector, amount, date, category, project,
  description, receipt dropzone.
- **Split a cost** — pick participants (member search), split mode, guests per person,
  live preview of each share, receipt. Open splits and "waiting for your answer" sit at
  the top of `/ledger/me` with one-tap accept/object.

Hooks: `useLedgerTransactions`, `useLedgerTransaction`, `useMyLedgerAccount`,
`useLedgerBalances`, `useLedgerStats`, `usePostTransaction`, `useDisputeTransaction`,
`useCostShares`, `useRespondToCostShare`.
All through the generated SDK.

Notifications (existing Apprise stack): a member is notified when a transaction credits
or debits **their** account, when they are added to a cost share (with the auto-accept
deadline), one day before that deadline, when their transaction is disputed, and when
their balance stays below the soft limit (D10).

---

## 11. What actually makes members trust it

Feature list, in rough order of trust-per-line-of-code:

1. **Everything is visible** (D8). No private ledger, no admin-only view of amounts.
2. **Nothing is ever edited or deleted** (D3/I4). Corrections are visible reversals that
   link to the original in both directions. The UI says "corrected by" / "corrects".
3. **Provenance on every row**: who entered it or which booking produced it, when, from
   which price source.
4. **The books add up, publicly**: `/api/ledger/health/` and a small footer widget
   showing "trial balance ✓ verified 04:00 today". A ledger that proves its own
   consistency in the UI is the cheapest trust feature available.
5. **Anyone can dispute** (D9), and the dispute plus its thread stay attached to the
   transaction forever, resolved or not.
6. **Receipt hashes** — the displayed SHA-256 means a receipt image cannot be swapped
   after the fact.
7. **Your own statement, exportable** (D12): a member who doubts their balance can
   download every line that produced it.
8. **Hash chain (phase 6, optional)**: `Transaction.hash = sha256(prev_hash ‖ canonical
   fields)`, with the daily head hash posted to the community channel. Makes any
   retroactive database edit — even one made directly in psql by an admin — detectable
   by anyone who saved yesterday's digest. Cheap to add once the rest is stable, and it
   changes the trust story from "trust the admins" to "verify the admins".

---

## 12. Bank import — the port, with the adapter deferred (D11)

The ledger core knows nothing about banks. The import pipeline is:

```
BankStatementSource (protocol)
    → fetch() / parse() → StatementLine rows (date, amount, counterparty,
                                              reference, end_to_end_id, raw_payload)
    → matcher → MatchProposal (line ↔ member, confidence, reason)
    → treasurer confirms (or auto-confirm above a confidence threshold)
    → post_transaction(kind=TOP_UP, idempotency_key="statement_line:<id>")
```

Models `StatementImport`, `StatementLine`, `MatchProposal` are bank-agnostic and can be
built now. Only `BankStatementSource` implementations differ:

- **File upload adapter** (CAMT.053 / MT940 / mapped CSV) — no credentials in the app.
- **PSD2 aggregator adapter** — scheduled pull, consent renewal, secrets management.
- **FinTS/EBICS adapter** — direct, no third party, per-bank fragility.

**Matching** relies on a stable **per-member payment reference** (e.g. `BUBBLE-7K3QX`,
shown on `/ledger/me` with copy-to-clipboard and a SEPA QR code). Reference match →
high confidence; IBAN seen before for that member → medium; name similarity → low, always
requiring confirmation. Unmatched lines land in `suspense:unmatched` so the bank balance
stays reconcilable even before someone assigns them.

Whatever adapter is chosen later plugs in behind the protocol; the pipeline, models,
matching and UI are written once.

---

## 13. Reporting and period close (D12)

- **Per-member statement**: all entries touching that member's account in a period, with
  opening and closing balance. CSV + PDF (WeasyPrint or ReportLab — pick during phase 5).
  *As built:* CSV from the API, and PDF through the browser's print dialog from a
  print-styled page (`/ledger/me/statement`, `/ledger/a/<id>/statement`). Neither
  WeasyPrint (system libraries) nor ReportLab is needed, so the image and the lock
  file stay as they are; a server-side PDF can follow if the tax advisor wants
  one.
- **Treasurer's annual report**: income/expense by category and by project, member
  balances at year end, bank/cash position, all reconciling to the trial balance.
  *As built:* `/ledger/report` (every member can read it, D8), printable and as CSV.
  It shows the check explicitly: the change in money equals the result plus what
  members and the other accounts gained or lost, and the trial balance is zero.
- **DATEV/CSV export**: requires stable account numbers, so `Account.code` is
  immutable once used and a `datev_number` field maps the chart of accounts to SKR42
  (or whatever the tax advisor uses). Exporting a period **closes** it
  (`LedgerPeriod.closed_at` + `export_hash`); postings with an `occurred_on` inside a
  closed period are rejected (I6) and must be booked in the open period as a correction
  with a reference to the original — standard practice, and it stops an export from
  going stale.

Retention: if the association is subject to German bookkeeping duties, receipts and
ledger rows fall under a 10-year retention obligation, which conflicts with a naive
"delete everything on account deletion" GDPR flow. Section 14 covers the handling; the
association should confirm its own obligations with its tax advisor.

**Statistics as built (phase 5).** `bubble/ledger/reports.py` aggregates `Entry`
rows directly (no rollup table yet, section 8). Every group carries `income` and
`expense` (the effect on the community's income and expense accounts), `amount`
(the money moved: the sum of a transaction's debit legs), `credited`/`charged` for
member groupings, and a transaction count. **Reversals and corrections count
against what they undo**: their amounts are subtracted and they are not counted as
transactions, so a reversed 30 € expense shows as 0, not as 60 € of turnover.
Groupings: category, project (with budget), month, member, item (items that were
deleted keep their line) and kind. `/ledger/stats` shows the totals as figures, the
groupings as bar lists (income blue, expenses orange, transfers grey; a legend and
the amount next to every bar, a tooltip on hover) and months as paired columns with
the numbers in a table underneath. A category or project opens the feed filtered to
it.

**Categories and projects UI (phase 5).** The treasurer adds income and expense
categories on `/ledger/manage`; each new one gets its own income or expense account
(`expense:<code>`), so it appears on its own line in the statistics and the report.
Categories can be renamed, reordered and retired (`is_active`), never deleted, and
their kind never changes; transfer categories belong to the system. Projects get a
name, optional budget and dates, and are archived rather than deleted; their slug
never changes. Seeded categories keep the app's translation until the treasurer
renames them (`has_default_name`).

---

## 14. Deletion, GDPR and users leaving

A user who leaves must not take the community's books with them.

- Ledger rows never reference a user directly: `Transaction.created_by` is the
  author's member *account*, and only `Account.owner` points at the user
  (`on_delete=SET_NULL`).
- Deleting a user **releases** their account (implemented in phase 1): a `pre_delete`
  hook renames it to "Former member #1a2b3c4d", clears `owner` and deactivates it.
  The account and every entry on it stay, so the books still add up. Everything else
  about deleting a user (their items, bookings…) is unchanged.
- A member with a non-zero balance cannot leave until it is settled: the hook raises
  `NonZeroBalanceError`, and the Django admin's delete page lists such members as
  protected objects with their balance, instead of failing mid-delete.
- An open `CostShare` involving the user is cancelled or re-split before release
  (phase 4).
- Receipts are the sensitive artefact (addresses, card digits, unrelated purchases). They
  are access-logged (D8) and the uploader can request replacement of a receipt image
  through a documented admin procedure that records the replacement — never a silent
  overwrite.

---

## 15. Testing strategy

- **Invariant tests**: every posting path asserts I1/I3; direct attempts to write an
  unbalanced transaction must raise at the DB level (test the trigger, not just the
  service). **Gotcha:** I1 is a deferred trigger that fires at `COMMIT`, and
  pytest-django's default `@pytest.mark.django_db` rolls each test back without ever
  committing — an unbalanced posting would pass silently. So `post_transaction()`
  itself runs `SET CONSTRAINTS … IMMEDIATE` right after writing (then defers again),
  which makes every ordinary test exercise the trigger; one `transaction=True` test
  proves the commit-time check without it. A global `SET CONSTRAINTS ALL IMMEDIATE`
  fixture would not work: the trigger on the transaction row would fire before its
  entries are inserted.
- **Property tests** (seeded `random`, no extra dependency): generate random sequences of postings, reversals and
  disputes; assert trial balance = 0, cached balances = recomputed sums, and that no
  sequence produces an edited or deleted row.
- **Concurrency**: two threads completing the same booking → exactly one transaction
  (idempotency); parallel postings touching overlapping accounts → no deadlock, correct
  balances.
- **Immutability**: `save()`/`delete()` on posted rows raise; the production DB grant is
  asserted in an ops check.
- **Architecture test**: no module outside `ledger/services.py` imports `Entry`.
- **Booking integration**: completion posts once, cancellation posts nothing, remote
  booker posts nothing, `payment_enabled = False` posts nothing, price precedence
  honoured, price change after posting does not alter the charge, a sale credits the
  seller captured *before* `transfer_ownership`; accepting a sale makes the item a
  `DRAFT` of the buyer and posts nothing; the buyer's approval posts once; the buyer's
  rejection charges nothing and returns the item to the seller as a `DRAFT`; the seller
  cannot cancel an accepted sale; the seller can still open the booking after the
  transfer.
- **Shared expenses**: property test that the rounding helper always sums exactly to
  the charged amount for random totals, weights and guest counts; a split posts only
  once (idempotency) even if the last acceptance and the auto-accept job race; an
  objection removes exactly one share; a correction cannot exceed the original leg;
  nobody can charge another member's account through any intent except a cost share.
- **Permissions**: a member cannot reverse someone else's transaction, cannot post a
  payout, cannot read a receipt unauthenticated; every member can read every amount.
- **E2E (Playwright)**: Alice posts the drill expense with a receipt → Bob sees it in the
  feed → Bob disputes → Alice reverses → both balances return to their prior values.

---

## 16. Phases

| Phase | Content | Ships |
|---|---|---|
| 1 ✅ | `ledger` app: models, migrations incl. the balance and append-only triggers, `post_transaction` + `reverse_transaction` (full and partial), rounding helper, chart-of-accounts seed, member accounts for every user, read-only Django admin, account release on user deletion, nightly verification, invariant + property + concurrency tests | nothing user-visible |
| 2 ✅ | Manual transactions (intents) + receipts in the database with access log + `/api/ledger/` read & write + feed, detail, my-account and member-balance pages, balance in the account hub and header menu | the drill scenario works end to end |
| 3 ✅ | Booking integration: `payment_enabled` gate, `Item.ledger_beneficiary` + community ownership in the UI, posting rentals on `COMPLETED`, sales accepted with ownership transfer to the buyer as a `DRAFT` (D17) and charged when the buyer approves the hand-over, or cancelled free of charge when the buyer rejects it (D18), reconciliation job, unbilled view | rentals and sales hit the ledger |
| 4 ✅ | Disputes, comment threads, reversals and partial corrections in the UI, notifications, soft-limit warnings and reminders; shared expenses (`CostShare`, confirmation flow, auto-accept job) | the trust layer; group cooking works |
| 5 ✅ | Categories/projects UI, statistics endpoints and page, per-member statement, treasurer's report | analytics and D12 part 1 |
| 6 | DATEV export + period close; bank import pipeline behind the port; hash chain and daily digest | D11/D12 completion |

Phases 1–2 are the ones worth over-engineering slightly; everything later is additive
because the core is append-only.

---

## 17. Open questions

1. **Which bank interface** (D11) — deferred by decision; section 12 keeps it cheap.
2. **Federated bookings**: remote actors have no local account. v1 leaves them unbilled.
   Cross-instance settlement would need its own protocol design and probably a
   per-instance clearing account.
3. **VAT / association tax status**: the model assumes no VAT on rentals. If that
   changes, entries need a tax leg — possible without schema change (an extra leg), but
   the intents in section 7 would need tax-aware variants.
4. **Multi-currency**: one currency per book, validated on every entry. Multi-currency
   would need per-entry FX rate and a revaluation account; not planned.
5. **Tax view of cost sharing**: shared expenses are private cost sharing between
   members and never touch the association's income accounts, which keeps them out
   of its books by construction. Worth confirming with the tax advisor anyway if
   settlements for them run through the association's bank account.
6. **Membership fees / recurring postings**: no scheduler in this design. If the
   community charges dues, add a `RecurringPosting` model in phase 5+ that calls
   `post_transaction` from a huey periodic task with a date-derived idempotency key.
7. ~~**Sales the buyer never approves**~~ — decided as D19: automatic approval after 3
   days, with a daily reminder until then.
