# Plan: AI-Generated Playwright E2E Tests as a Release Gate

## 1. Goal

Stand up an end-to-end (E2E) test suite for Bubble that is:

1. **Written with Playwright** against the real, deployed app.
2. **Generated and maintained by AI** — Claude detects app functionality (routes,
   API surface, UI flows), writes the specs, and **adapts them when features
   change** instead of us hand-editing every test.
3. **Run regularly in CI/CD against `https://main.sharebubble.com`**.
4. **A hard gate on releases** — a new release (git tag `v*.*.*` and the `promote`
   step that ships `:latest` images) can only be created when the latest E2E run
   is green.
5. **Realistic** — exercises multiple concurrent users, seeds its own test data,
   and tears that data down again, so it covers create/read/update/delete and
   multi-actor flows (offers, counter-offers, bookings, collections, favorites).

This document is the implementation plan. It is grounded in the current stack and
CI (see §2) and is organized as phased, checkable work (see §12).

---

## 2. Current state (what we build on)

**App under test**

- **Frontend** (`frontend/`): React 19 + Vite + TypeScript + Mantine, React Router.
  Routes today: `/`, `/auth`, `/item/:itemUuid`, `/create-item`,
  `/edit-item/:itemUuid`, `/edit-book/:itemUuid`, `/my-items`, `/profile`,
  `/bookings`, `/requests/:bookingId?`, `/collections`, `/collections/:collectionId`.
- **Backend** (`backend/`): Django 5 + DRF. Apps: `items`, `books`, `bookings`,
  `collections`, `favorites`, `notifications`, `users`, `federation`, `caldav`,
  `core`. UUID PKs, object-level permissions (`django-guardian`), Channels
  (WebSockets) for notifications.
- **Auth**: django-allauth **headless** API (session + CSRF; the frontend calls
  `authAPI.getSession/login/logout`). A DRF token endpoint also exists at
  `POST /api/auth-token/`. There is a `REQUIRE_LOGIN` app-config flag.
- **API contract**: backend publishes an **OpenAPI schema**; the frontend SDK is
  generated from it (`npm run types:openapi`). This schema is the machine-readable
  source of truth the generator uses to discover functionality.

**CI/CD today** (`.github/workflows/`)

- `ci.yml`: `linter` + `pytest` on every PR/push; `build-backend` / `build-frontend`
  push images on `main`/`develop`; **`promote`** runs on tag `v*.*.*` and retags the
  `main-<sha>` images to the version and `:latest`.
- `release-please.yml`: on push to `main`, `googleapis/release-please-action`
  maintains a **release PR**; merging it bumps the version and creates the
  `v*.*.*` tag, which triggers `promote`.

**Consequence for the gate**: the release "happens" at the tag → `promote` step.
So the gate is implemented by making a green E2E run a **required precondition of
tagging / promoting** (see §7).

**Existing test data tooling**: pytest `factory_boy` factories exist per app
(`backend/bubble/*/tests/factories.py`) but are unit-test only. For E2E against a
live environment we need an **API/management-command based** seeding+teardown path
(see §6) — we do **not** reuse the pytest DB fixtures against prod.

---

## 3. Architecture overview

```
                         ┌──────────────────────────────────────────────┐
                         │   Repo: frontend/ + backend/ (source of truth)│
                         │   OpenAPI schema  +  React routes  +  hooks   │
                         └───────────────┬──────────────────────────────┘
                                         │  feeds
                    ┌────────────────────▼─────────────────────┐
                    │  AI Test Generator (Claude + Playwright   │
                    │  MCP)  — discovers features, writes/updates│
                    │  specs & page objects, opens a PR          │
                    └────────────────────┬─────────────────────┘
                                         │  commits
                    ┌────────────────────▼─────────────────────┐
                    │  e2e/  (Playwright project, versioned)     │
                    │  fixtures · page objects · specs · seeding │
                    └───────┬───────────────────────┬───────────┘
        scheduled / on-deploy│                       │ pre-release
                    ┌────────▼─────────┐    ┌────────▼──────────┐
                    │ e2e-scheduled.yml│    │ release-gate.yml  │
                    │ cron + deploy →  │    │ tag-time E2E must │
                    │ main.sharebubble │    │ be green → promote│
                    └──────────────────┘    └───────────────────┘
```

Three moving parts: **(a)** a versioned Playwright project in `e2e/`, **(b)** an
AI generator/adapter that keeps `e2e/` in sync with the app, and **(c)** CI
workflows that run it on a schedule and as a release gate.

---

## 4. Phase A — Playwright test harness (`e2e/`)

Create a standalone Playwright workspace so it stays decoupled from the Vite app
and can target any base URL.

```
e2e/
  package.json                # @playwright/test, dotenv, zod (config validation)
  playwright.config.ts        # projects (chromium/firefox/webkit), baseURL from env
  tsconfig.json
  .env.example                # E2E_BASE_URL, E2E_API_URL, secrets *names* only
  fixtures/
    auth.ts                   # per-role authenticated browser contexts (storageState)
    users.ts                  # provisions/loads the multi-user pool
    testData.ts               # seed + auto-teardown fixture (unique run namespace)
  support/
    api.ts                    # thin API client (allauth login, DRF token, CRUD)
    namespace.ts              # E2E-<runId> tagging for created records
  pages/                      # Page Object Models — one per route/surface
    AuthPage.ts  IndexPage.ts  ItemDetailPage.ts  CreateItemPage.ts
    MyItemsPage.ts  BookingsPage.ts  RequestsPage.ts  CollectionsPage.ts ...
  specs/
    smoke/                    # fast, must-always-pass (login, browse, health)
    items/  bookings/  collections/  books/  favorites/  federation/
  reporters/                  # HTML + JSON + (optional) GitHub annotations
```

Key config decisions:

- **`baseURL` and `apiURL` come from env** (`E2E_BASE_URL` defaults to
  `https://main.sharebubble.com`) so the same suite runs against local, staging,
  and the release-gate target with no code change.
- **`storageState` per role**: log each pooled user in once in a setup project,
  persist the session/CSRF cookies, and reuse them — fast and parallel-safe.
- **Test tiers via Playwright projects/tags**: `@smoke` (blocking, <2 min),
  `@regression` (full), `@destructive` (isolated data only). The release gate runs
  `@smoke` + `@regression`; the schedule runs everything.
- **Selector policy**: require stable `data-testid` attributes. The generator adds
  missing `data-testid`s to the React components as part of its PRs so tests are
  resilient to Mantine markup/label changes (see §5, §11).
- **Traces/screenshots/video on failure** uploaded as CI artifacts; retries=2 on CI
  to absorb network flakiness against a live environment.

**Deliverables:** runnable `npx playwright test` locally against a dev stack
(`just up`) and against `main.sharebubble.com` with `E2E_BASE_URL` set.

---

## 5. Phase B — AI test generation & adaptation

The generator is a Claude-driven job (runnable locally and in CI) that keeps
`e2e/` in sync with the app. It combines **static discovery** (deterministic) with
**AI authoring** (Claude) and **live verification** (Playwright MCP).

### 5.1 Feature discovery (deterministic inputs Claude reads)

1. **Backend OpenAPI schema** — enumerate every endpoint, method, request/response
   shape, and permission. This is the authoritative list of "what the app can do".
2. **Frontend routes** — parse `frontend/src/App.tsx` `<Route>` tree for the page
   surface and which routes are `<AuthRequired>`.
3. **React Query hooks** (`frontend/src/hooks/`) — map UI actions → API calls
   (e.g. `useItems`, `useBookings`) so specs assert the right side effects.
4. **Existing `e2e/` suite + coverage** — what's already covered, so it only writes
   the delta.

### 5.2 Generation loop (Claude + Playwright MCP)

For each uncovered feature/flow:

1. Claude drafts a **page object** + **spec** from the discovery inputs and the
   conventions in `e2e/AGENTS.md` (a house-style guide we author once).
2. Claude drives the **Playwright MCP** against a disposable environment (a fresh
   `just up` stack in CI, seeded via §6) to **self-verify**: it runs the draft,
   reads failures/traces, and iterates until green — so it only commits tests that
   actually pass.
3. When a stable selector is missing, Claude adds a `data-testid` to the relevant
   React component **in the same PR** (small, reviewable frontend diffs).
4. Output is a **pull request** (never a direct push), labeled `e2e-generated`,
   with a summary of new/changed coverage.

### 5.3 Adaptation triggers (keeping tests current as features arrive)

- **On merge to `main` that touches `frontend/**`, `backend/**`, or the OpenAPI
  schema** → run the generator in "diff mode": regenerate only affected specs, open
  a PR. This is how tests "adapt when new features arrive".
- **Nightly full reconciliation** → detect drift (routes/endpoints with no test,
  tests hitting removed endpoints) and open a single housekeeping PR.
- **On repeated flake/failure of an existing spec** → a "repair" run where Claude
  reads the trace and proposes a fix (selector drift vs. real regression — it
  labels which).

### 5.4 Guardrails

- Generator only ever opens PRs; humans (or an auto-merge policy for `@smoke`-only,
  green diffs) approve. Generated tests must pass the self-verification step and CI
  before merge.
- A prompt/style contract in `e2e/AGENTS.md` pins conventions (POM structure,
  `data-testid` naming, namespacing, no hard-coded prod data, teardown required).
- Cost/scope caps: diff-mode by default; full regen only nightly.

**Implementation options for the generator runner** (decide in Phase B):
Claude Code in a scheduled GitHub Action (Claude Code GitHub app / `claude` CLI)
or the Agent SDK. Either way it needs an `ANTHROPIC_API_KEY` secret and the
Playwright MCP server configured against the CI stack.

---

## 6. Phase C — Multi-user & test-data lifecycle

Testing multi-actor flows (an owner lists an item, a renter makes an offer, the
owner counter-offers, a booking is confirmed) requires several real users and
data that is created and then removed.

### 6.1 User pool

- A fixed pool of **dedicated E2E users** on `main.sharebubble.com`, e.g.
  `e2e-owner`, `e2e-renter-a`, `e2e-renter-b`, `e2e-admin`. Credentials live in
  GitHub Secrets (see §8), never in the repo.
- The `auth`/`users` fixtures log each in via the **allauth headless** endpoints
  (or DRF `/api/auth-token/` for pure API setup) and cache `storageState`.
- Roles map to real app capabilities so permission-dependent UI is exercised.

### 6.2 Data seeding & teardown (the safe part)

Two options; **prefer the management-command approach** for a production-adjacent
target:

- **Preferred — backend seed/purge commands**: add `manage.py seed_e2e` and
  `manage.py purge_e2e` that create/delete records **tagged with an E2E namespace**
  (`E2E-<runId>` in a dedicated field or via a reserved test account). `purge_e2e`
  only ever deletes namespaced records, and both commands **refuse to run unless an
  explicit `E2E_ALLOW=1` env is set** and the target is flagged non-critical. This
  guarantees prod-safe, complete cleanup even if a test crashes mid-run.
- **Alternative — API-only**: the `testData` fixture creates everything through the
  public API using the pooled users and records created UUIDs, then deletes them in
  an `afterAll`/finalizer. Simpler, but a crashed run can leak data (mitigated by a
  nightly namespaced sweep).

### 6.3 Isolation & namespacing

- Every record a test creates is prefixed/tagged with the **run id** so parallel
  runs and parallel workers never collide and cleanup is exact.
- `@destructive` tests (delete item, cancel booking) operate **only** on data they
  created in the same test.
- A **nightly janitor** job runs `purge_e2e` (or the namespaced API sweep) to catch
  anything a crashed run leaked, keeping `main.sharebubble.com` clean.

### 6.4 Coverage matrix (what "all kinds of cases" means here)

| Domain | Happy path | Edge / negative | Multi-user |
|---|---|---|---|
| Auth | login, logout, session persist | wrong password, `REQUIRE_LOGIN` gating | — |
| Items | create/edit/delete, images, AI descriptors | validation errors, permission denial | owner vs. viewer visibility |
| Books | ISBN lookup, metadata | invalid ISBN | — |
| Bookings | offer → accept → confirm | overlapping-booking rejection (exclusion constraint) | owner ↔ renter, counter-offers |
| Collections | create, add/remove items, share | permission on private collections | shared collection across users |
| Favorites | add/remove | — | per-user isolation |
| Notifications | receive on booking event | — | actor triggers, recipient sees (WebSocket) |
| Federation | (optional, flagged) item visibility Public vs Local | — | cross-instance (if a peer test env exists) |

---

## 7. Phase D — CI/CD: scheduled runs + release gate

### 7.1 Scheduled / on-deploy run — `e2e-scheduled.yml`

- **Triggers**: `schedule` (cron, e.g. every 2 h during the day), `workflow_dispatch`,
  and a `repository_dispatch`/`workflow_run` fired **after a successful deploy of
  `main` to `main.sharebubble.com`** (post-`promote`, or hooked into the deploy).
- **Job**: install Playwright, run `@smoke @regression` (and full suite on the
  nightly cron) against `E2E_BASE_URL=https://main.sharebubble.com`.
- **Outputs**: HTML report + traces as artifacts; write the result to a **commit
  status / check** named `e2e-main` on the latest `main` SHA, and record
  latest-green in a small durable place (a `deployments`/status API entry or a
  badge). This status is what the gate reads.
- **On failure**: open/annotate an issue, notify (Slack/Sentry), and — because this
  is the release signal — **block releases** (next section).

### 7.2 Release gate

The release currently materializes at **tag `v*.*.*` → `promote`**. Insert the gate
there. Two complementary layers:

1. **Gate the tag/release** (recommended primary): make merging the **release-please
   PR** require the `e2e-main` status to be green. Options:
   - Add `e2e-main` as a **required status check** on `main` / on the release-please
     PR via branch protection, so the release PR cannot merge (and thus cannot tag)
     while E2E is red.
   - Or add a `release-gate` job in `release-please.yml` that, when
     `release_created`/PR is about to proceed, **queries the latest `e2e-main`
     status and fails if not green**.
2. **Gate the promote step** (defense in depth): add a `needs`/pre-job to the
   `promote` job in `ci.yml` that runs a **fresh `@smoke` E2E pass against
   `main.sharebubble.com` at tag time** and fails the promote if red. This ensures
   we never retag `:latest` on top of a currently-broken environment even if the
   scheduled status was stale.

Net effect: **no green E2E ⇒ no tag ⇒ no `:latest` promotion ⇒ no release.**

### 7.3 PR pre-merge smoke (optional, cheap)

On PRs, spin up an ephemeral stack (`just up`) and run `@smoke` against it so
regressions are caught before they reach `main` — reduces how often the release
gate is what surfaces a break. Keep it to smoke to protect PR latency.

---

## 8. Secrets & configuration

Store in GitHub Actions secrets / environment `production-e2e`:

- `E2E_BASE_URL` = `https://main.sharebubble.com`, `E2E_API_URL` (if split).
- `E2E_USER_*` credentials for each pooled user (owner, renter-a, renter-b, admin).
- `E2E_ALLOW=1` and any seed/purge auth for the management-command path.
- `ANTHROPIC_API_KEY` for the generator.
- Optional: `SLACK_WEBHOOK`/Sentry DSN for alerting.

Config precedence: env vars → `e2e/.env` (local only, git-ignored) → defaults.
`.env.example` documents names only. Never commit real credentials.

---

## 9. Alerting & reporting

- Publish the Playwright **HTML report** as a CI artifact; optionally to GitHub
  Pages for a stable "latest run" URL.
- Failures post to Slack/Sentry with a link to the trace.
- Track flake rate; auto-file a repair task (§5.3) when a spec flakes N times.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Tests mutate/pollute production data | Namespaced records + `purge_e2e` guarded by `E2E_ALLOW`; nightly janitor; `@destructive` only touches self-created data. |
| Running E2E *against* the same env we gate creates chicken/egg | Gate reads the **latest scheduled** green status + a fresh smoke pass at tag time; don't require a full run synchronously inside promote. |
| AI generates flaky/incorrect tests | Self-verification loop (§5.2) — only committed if green; PR-only; human/auto-merge policy; smoke tier kept tiny and stable. |
| Selector fragility with Mantine | Mandatory `data-testid`; generator adds them to components in the same PR. |
| Live-env flakiness (network) | Retries, trace-on-failure, smoke/regression split, run isolation. |
| Secret leakage | Secrets only in GH environments; `.env` git-ignored; example files carry names only. |
| Cost of AI generation | Diff-mode on merges, full regen nightly only, scope caps. |
| Multi-user race conditions | Per-run namespacing, `storageState` per role, worker-scoped data. |

---

## 11. Small app-side prerequisites

- Add `data-testid` attributes to key interactive elements (generator will extend
  these over time; seed the critical-path ones first: auth form, item card,
  create-item form, booking actions).
- Backend `seed_e2e` / `purge_e2e` management commands + an E2E namespace field or
  reserved account convention (§6.2).
- Confirm `main.sharebubble.com` exposes the allauth headless + `/api/auth-token/`
  endpoints to the CI runner (network/CORS/allowed hosts), and decide whether it is
  the true prod or a main-tracking staging (affects how aggressive seeding can be).

---

## 12. Rollout checklist (phased)

**Phase A — Harness (foundation)**
- [ ] Scaffold `e2e/` (config, tsconfig, deps), `baseURL`/`apiURL` from env.
- [ ] `support/api.ts` (allauth login + DRF token + CRUD), `namespace.ts`.
- [ ] Auth fixture with per-role `storageState`; user pool fixture.
- [ ] First hand-written `@smoke` suite (login, browse home, open item) green
      against local `just up`.

**Phase C — Data lifecycle (unblocks realistic tests)**
- [ ] `seed_e2e` / `purge_e2e` commands (or API-only fixture) with `E2E_ALLOW` guard.
- [ ] `testData` fixture with automatic namespaced teardown.
- [ ] Multi-user booking flow spec (owner ↔ renter offer/counter/confirm).

**Phase D — CI wiring**
- [ ] `e2e-scheduled.yml`: cron + dispatch + post-deploy run vs `main.sharebubble.com`,
      writes `e2e-main` status, uploads artifacts.
- [ ] Release gate: `e2e-main` required check on release-please PR **and** a smoke
      pre-job on `promote`.
- [ ] Nightly janitor job (`purge_e2e` / namespaced sweep).
- [ ] Optional PR smoke against ephemeral stack.

**Phase B — AI generation (scale coverage, keep it current)**
- [ ] `e2e/AGENTS.md` house-style + generation contract.
- [ ] Discovery script (OpenAPI + routes + hooks + coverage → work list).
- [ ] Generator job (Claude + Playwright MCP, self-verify, PR-only).
- [ ] Adaptation triggers: on-merge diff-mode, nightly reconciliation, flake repair.
- [ ] `data-testid` backfill PRs as coverage grows.

**Order rationale:** A → C give a trustworthy hand-written smoke/regression base and
safe data handling; D turns that into the release gate the moment it's reliable; B
then scales and maintains coverage on top of a proven harness (so we never gate
releases on unproven AI-authored tests).
