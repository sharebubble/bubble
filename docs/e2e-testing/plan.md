# Plan: AI-Generated Playwright E2E Tests as a Release Gate

## 1. Goal

Stand up an end-to-end (E2E) test suite for Bubble that is:

1. **Written with Playwright** against the real, deployed app.
2. **Generated and maintained by AI** — Claude detects app functionality (routes,
   API surface, UI flows), writes the specs, and **adapts them when features
   change** instead of us hand-editing every test.
3. **Run regularly in CI/CD against `https://main.sharebubble.org`**.
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
  `/bookings/:bookingId?`, `/collections`, `/collections/:collectionId`.
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

**Deployment**: the app runs on **Kubernetes via the Helm chart** (`helm/`).
Image tags are set by `backend.image.tag` / `frontend.image.tag` in
`helm/values.yaml`; images are published to GHCR tagged `main-<sha>` on every push
to `main`. **`main.sharebubble.org` is a fully-functional stage/testing
environment** (not production) that tracks `main`. Because it is stage, seeding can
be liberal — but we still namespace and clean up (see §6) so parallel runs and
manual testing on stage don't collide.

**Consequence for the gate**: the release "happens" at the tag → `promote` step,
and `promote` is what ships `:latest` to production. The gate is therefore:
deploy each `main` commit to **stage**, run E2E against stage, and only then let
**release-please propose a version** (which, when merged, tags and promotes to
prod). See §7 for the full pipeline and why this cleanly avoids a
chicken-and-egg cycle.

**No version endpoint exists yet.** To know that stage is actually serving the
commit under test (k8s rolling updates lag), we must add a version endpoint that
reports the built git SHA (see §7.1 and §11).

**Existing test data tooling**: pytest `factory_boy` factories exist per app
(`backend/bubble/*/tests/factories.py`) but are unit-test only. For E2E against a
live environment we need an **API/management-command based** seeding+teardown path
(see §6) — we do **not** reuse the pytest DB fixtures against the stage DB.

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
                    └───────────────────┬───────────────────────┘
                                        │ consumed by the main pipeline (§7)
        ┌───────────────────────────────▼──────────────────────────────┐
        │  push to main                                                 │
        │   → lint + pytest + build images (main-<sha>)                 │
        │   → ArgoCD ApplicationSet auto-deploys main-<sha> to stage    │
        │   → version guard: poll /api/version until git_sha == <sha>   │
        │   → E2E against stage                                         │
        │   → [green] release-please proposes a version → tag → promote │
        └───────────────────────────────────────────────────────────────┘
```

Three moving parts: **(a)** a versioned Playwright project in `e2e/`, **(b)** an
AI generator/adapter that keeps `e2e/` in sync with the app, and **(c)** a CI
pipeline that deploys each `main` commit to stage, verifies the running version,
runs E2E, and gates release-please on the result (plus a scheduled run for drift).

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
  `https://main.sharebubble.org`) so the same suite runs against local, staging,
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
(`just up`) and against `main.sharebubble.org` with `E2E_BASE_URL` set.

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

- A fixed pool of **dedicated E2E users** on `main.sharebubble.org`, e.g.
  `e2e-owner`, `e2e-renter-a`, `e2e-renter-b`, `e2e-admin`. Credentials live in
  GitHub Secrets (see §8), never in the repo.
- The `auth`/`users` fixtures log each in via the **allauth headless** endpoints
  (or DRF `/api/auth-token/` for pure API setup) and cache `storageState`.
- Roles map to real app capabilities so permission-dependent UI is exercised.

### 6.2 Data seeding & teardown

Since `main.sharebubble.org` is a **stage** environment (not production), seeding can
be liberal — we can even reset to a known baseline dataset. We still namespace and
clean up so parallel pipeline runs, the scheduled run, and humans testing on stage
don't collide. Two options; **prefer the management-command approach**:

- **Preferred — backend seed/purge commands**: add `manage.py seed_e2e` and
  `manage.py purge_e2e` that create/delete records **tagged with an E2E namespace**
  (`E2E-<runId>` in a dedicated field or via a reserved test account). `purge_e2e`
  only ever deletes namespaced records, and both commands **refuse to run unless an
  explicit `E2E_ALLOW=1` env is set** (a guard against ever pointing them at prod).
  This guarantees complete cleanup even if a test crashes mid-run.
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
  anything a crashed run leaked, keeping `main.sharebubble.org` clean.

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

## 7. Phase D — CI/CD: the main pipeline & release gate

### 7.0 The chicken-and-egg problem and how we avoid it

A naive gate — "run E2E against the deployed env *inside* the tag → `promote` step,
and only promote if green" — is circular: the environment only serves the new code
**after** it's deployed, but we want E2E to pass **before** we allow the release. So
E2E would test the *old* code and then wave through *new, untested* code.

**The fix is to separate "deploy to stage" from "cut a release."** Stage
(`main.sharebubble.org`) is redeployed on **every** push to `main`, unconditionally.
E2E runs against **stage**. Only the **release** (release-please's version proposal →
tag → prod `promote`) is gated on that E2E being green. The tested environment
(stage) and the gated artifact (the prod release) are now different things, so there
is no cycle: stage always tracks `main` HEAD; the release is strictly downstream of a
green stage run.

### 7.1 The main pipeline (on push to `main`) — `main-pipeline.yml`

A single linear, gated pipeline. Each step is `needs:` the previous.

1. **Lint + pytest** — existing `linter` + `pytest` jobs.
2. **Build & push images** — existing `build-backend` / `build-frontend`, tagged
   `main-<sha>`. The SHA is **baked into the image** as a build arg (see §7.2).
3. **Deploy to stage (ArgoCD ApplicationSet, auto-sync)** — stage is deployed by an
   **ArgoCD ApplicationSet** that reads the `main` head SHA and renders an Application
   pinned to the immutable image `main-<sha>`, always auto-syncing (see §7.1a). CI
   does **not** drive the deploy at all — it just proceeds to the version guard.
4. **Version guard** — after Argo reports Synced + Healthy, **poll the stage version
   endpoint until it reports the exact `<sha>`** (see §7.2), with a timeout (e.g. 10
   min) and backoff. Argo "Healthy" means the rollout's readiness probes passed, **not**
   that every pod behind the Service already serves the new image — during a rolling
   update old and new pods coexist. The version guard is the authoritative
   "is the commit under test actually being served?" check, and it belongs in CI
   regardless of the Argo integration style. Guard **both** tiers (backend
   `/api/version` and the frontend build SHA) so we don't test a new backend behind an
   old frontend or vice-versa.
5. **E2E against stage** — `E2E_BASE_URL=https://main.sharebubble.org`, run
   `@smoke @regression`. Upload HTML report + traces as artifacts. Write the result
   to a commit **status/check** named `e2e-main` on the `<sha>`.
6. **Release-please (gated)** — run `googleapis/release-please-action` **only if step
   5 passed** (`needs: [e2e]`, `if: success()`). This is the "only when E2E passes,
   release-please suggests a new version" requirement: no green E2E ⇒ release-please
   does not run ⇒ no release PR is created/updated ⇒ no version, tag, or prod promote.

```
lint+pytest ─▶ build(main-<sha>) ─▶ deploy stage ─▶ version-guard(==<sha>)
              ─▶ e2e(stage) ──[green]──▶ release-please ──(merge)──▶ tag ─▶ promote(:latest→prod)
                        └──[red]──▶ stop; no release proposed
```

**Restructure of existing workflows**: move the release-please trigger out of the
standalone `release-please.yml` (which currently runs on *every* push to `main`,
ungated) and make it the terminal, `needs`-gated job of this pipeline — or keep
`release-please.yml` but trigger it via `workflow_run` on **successful completion of
the E2E workflow only** (`workflows: [main-pipeline], types: [completed]`, guarded by
`conclusion == 'success'`). Either way the invariant is: release-please only ever
runs after a green stage E2E for that commit.

### 7.1a Stage deploy: ArgoCD ApplicationSet (auto-sync to the latest `main` SHA)

Stage is deployed by an **ArgoCD ApplicationSet** that reads the head commit SHA of
`main` and renders an Application pinned to the exact image `main-<sha>`, with
**auto-sync always on** (`syncPolicy.automated`, `selfHeal` + `prune`). So **every
push to `main` is deployed to stage automatically, pinned to that commit's immutable
image** — no CI-driven `helm upgrade`, no GitOps values bump, no manual
`argocd app sync`.

Generator: an **SCM Provider generator** filtered to the `main` branch of
`sharebubble/bubble`, exposing `{{ .sha }}` (branch head). With `goTemplate: true`
the template sets the Helm image tags from it:

```yaml
# sketch — ApplicationSet
spec:
  goTemplate: true
  generators:
    - scmProvider:
        github: { organization: sharebubble }
        filters: [{ branchMatch: '^main$', repositoryMatch: '^bubble$' }]
        requeueAfterSeconds: 60          # or drive via webhook for promptness
  template:
    spec:
      source:
        helm:
          parameters:
            - { name: backend.image.tag,  value: 'main-{{ .sha | trunc 7 }}' }
            - { name: frontend.image.tag, value: 'main-{{ .sha | trunc 7 }}' }
      syncPolicy:
        automated: { prune: true, selfHeal: true }
```

**Tag-format alignment (correctness gotcha).** CI builds `main-<sha>` via
`docker/metadata-action` (`type=ref,event=branch,suffix=-{{sha}}`, which emits the
**short 7-char** SHA). The ApplicationSet must render the **same** string, hence
`main-{{ .sha | trunc 7 }}`. If the formats diverge (short vs full SHA), Argo pins a
tag CI never pushed → pods `ImagePullBackOff` and the version guard times out. Pin the
format in one place and assert it (a tiny CI check comparing the built tag to the
templated tag).

**Ordering.** The image must exist before Argo pulls it. Per push:
(1) CI builds+pushes `main-<sha>`; (2) the ApplicationSet re-scans, sees the new head
SHA, auto-syncs, pulls `main-<sha>`; (3) the version guard confirms serving. If the
build fails the image is absent, Argo sits in `ImagePullBackOff`, the guard times out,
and release-please never runs — exactly the behavior we want.

**Consequence for CI — the version guard is the *sole* sync primitive.** With
auto-sync always on, CI has no "sync started for this commit" signal, so step 4's
timeout must comfortably cover *ApplicationSet requeue interval + sync + rollout*.
Optionally CI can POST to the ApplicationSet/Argo **webhook** right after the image
push to cut requeue latency (needs an Argo token/webhook secret) — a nice-to-have, not
required.

**Superseded-commit race (must handle).** Because the ApplicationSet always deploys
the *latest* `main` SHA, if commit N+1 lands while commit N's pipeline is still
waiting, stage jumps to N+1 and the guard polling for `main-<shaN>` never matches →
false failure for N. Fix: give the main pipeline a **stable concurrency group with
`cancel-in-progress: true`** (e.g. `group: main-e2e-gate`), so a newer commit cancels
the older run. This mirrors ApplicationSet semantics — only the latest commit matters,
and only the latest commit's E2E should gate a release. (Note: `ci.yml` today keys
concurrency on `run_id` for pushes, which does *not* cancel across commits; the E2E
pipeline needs its own stable-group concurrency.)

### 7.2 Version endpoint & SHA baking (new prerequisite)

The version guard needs a reliable "what commit is stage actually running?" signal.
There is no such endpoint today (only `/api/config/` and `/federation/health`).

- **Bake the SHA at build time**: add `ARG GIT_SHA` to `backend/Dockerfile` and
  `frontend/Dockerfile`, pass `--build-arg GIT_SHA=${{ github.sha }}` from the build
  jobs, and surface it at runtime (backend env var; frontend via `VITE_GIT_SHA` at
  build).
- **Backend**: add `GET /api/version` → `{ "git_sha": "...", "version": "<release>" }`
  (a tiny DRF view alongside `ConfigView`). Unauthenticated, cheap.
- **Frontend**: emit the SHA into the built bundle (e.g. a `/version.json` asset or a
  `<meta name="git-sha">`) so the guard confirms the frontend rolled over too.
- The guard polls both until both equal `<sha>` (or times out → pipeline fails before
  E2E, surfacing a deploy/rollout problem rather than a misleading E2E result).

### 7.3 Scheduled drift run — `e2e-scheduled.yml`

Independent of the deploy pipeline, run the **full** suite against stage on a
`schedule` (e.g. nightly) plus `workflow_dispatch`. Catches environmental drift, data
issues, and flakes that a per-commit run might miss, and keeps an always-current
`e2e-main` signal even on days with no `main` pushes. Same artifacts + alerting.

### 7.4 PR pre-merge smoke (optional, cheap)

On PRs, spin up an ephemeral stack (`just up`) and run `@smoke` against it so
regressions are caught before they reach `main` — reduces how often the stage
pipeline is what first surfaces a break. Keep it to smoke to protect PR latency.

---

## 8. Secrets & configuration

Store in GitHub Actions secrets / environment `production-e2e`:

- `E2E_BASE_URL` = `https://main.sharebubble.org`, `E2E_API_URL` (if split).
- `E2E_USER_*` credentials for each pooled user (owner, renter-a, renter-b, admin).
- `E2E_ALLOW=1` and any seed/purge auth for the management-command path.
- *(optional)* `ARGOCD_SERVER` + `ARGOCD_AUTH_TOKEN` **only** if CI pokes the
  ApplicationSet/Argo webhook to cut requeue latency (§7.1a). The auto-syncing
  ApplicationSet needs no CI-side deploy credential otherwise.
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
| Tests mutate/pollute stage data | Namespaced records + `purge_e2e` guarded by `E2E_ALLOW`; nightly janitor; `@destructive` only touches self-created data. |
| Chicken-and-egg: can't test the release before it exists | Decouple deploy-to-stage from cut-a-release: stage redeploys on every `main` push, E2E runs there, only the prod release is gated (§7.0). |
| E2E runs before the rollout finishes → tests the old image | **Version guard** polls `/api/version` (+ frontend SHA) until both equal the commit `<sha>` before E2E starts (§7.2). |
| ApplicationSet auto-syncs to newest SHA → in-flight older pipeline's guard never matches | Stable-group concurrency with `cancel-in-progress` cancels superseded runs (§7.1a). |
| ApplicationSet renders a tag CI never pushed (short/full SHA mismatch) | Align tag format (`main-{{ .sha \| trunc 7 }}`) + CI assertion that built tag == templated tag (§7.1a). |
| AI generates flaky/incorrect tests | Self-verification loop (§5.2) — only committed if green; PR-only; human/auto-merge policy; smoke tier kept tiny and stable. |
| Selector fragility with Mantine | Mandatory `data-testid`; generator adds them to components in the same PR. |
| Live-env flakiness (network) | Retries, trace-on-failure, smoke/regression split, run isolation. |
| Secret leakage | Secrets only in GH environments; `.env` git-ignored; example files carry names only. |
| Cost of AI generation | Diff-mode on merges, full regen nightly only, scope caps. |
| Multi-user race conditions | Per-run namespacing, `storageState` per role, worker-scoped data. |

---

## 11. Small app-side prerequisites

- **Version endpoint + SHA baking** (needed by the pipeline's version guard, §7.2):
  `ARG GIT_SHA` in `backend/Dockerfile` and `frontend/Dockerfile`, passed as
  `--build-arg GIT_SHA=${{ github.sha }}`; backend `GET /api/version` returning
  `{ git_sha, version }`; frontend exposes its build SHA (`/version.json` or meta tag).
- Add `data-testid` attributes to key interactive elements (generator will extend
  these over time; seed the critical-path ones first: auth form, item card,
  create-item form, booking actions).
- Backend `seed_e2e` / `purge_e2e` management commands + an E2E namespace field or
  reserved account convention (§6.2).
- **ArgoCD ApplicationSet** (stage deploy, §7.1a): author the SCM-generator
  ApplicationSet that pins `main-{{ .sha | trunc 7 }}` and auto-syncs; ensure its
  rendered tag **exactly matches** CI's `docker/metadata-action` output, and add a CI
  check asserting the two agree. Also confirm stage exposes allauth headless +
  `/api/auth-token/` + `/api/version` to the CI runner (network/CORS/allowed hosts).

---

## 12. Rollout checklist (phased)

**Phase A — Harness (foundation)**
- [ ] Scaffold `e2e/` (config, tsconfig, deps), `baseURL`/`apiURL` from env.
- [ ] `support/api.ts` (allauth login + DRF token + CRUD), `namespace.ts`.
- [ ] Auth fixture with per-role `storageState`; user pool fixture.
- [ ] First hand-written `@smoke` suite (login, browse home, open item) green
      against local `just up`.

**Phase C — Data lifecycle (unblocks realistic tests)**
- [x] `seed_e2e` / `purge_e2e` commands with `E2E_ALLOW` guard (namespaced purge,
      `--run-id`/`--dry-run`/`--users`; pool users get verified emails + Default group).
- [x] `testData` fixture + per-test API cleanup with run-scoped namespacing.
- [x] Multi-user booking flow spec: negotiation (offer→counter→confirm→complete)
      and the overlap exclusion constraint (owner + renterA + renterB).

**Phase D — CI wiring**
- [x] Version endpoint + `GIT_SHA` build-arg in both Dockerfiles (§7.2), and
      `ci.yml` build jobs pass `--build-arg GIT_SHA=${{ github.sha }}`.
- [x] `e2e.yml`: on CI-success(main)/schedule/dispatch → resolve latest `main` SHA →
      version-guard(stage serves `<sha>`) → run suite → upload report. Stable-group
      concurrency w/ `cancel-in-progress`; needs a GitHub `e2e` environment.
- [x] **release-please gated on E2E** (§7.1 step 6): a `needs: [e2e]` job in
      `e2e.yml` runs release-please only after a green suite on the main push path;
      the ungated standalone `release-please.yml` was removed. Red suite / failed
      version guard ⇒ no version proposed ⇒ no tag ⇒ no prod promote.
- [ ] ArgoCD ApplicationSet (§7.1a): SCM generator on `main`, pin
      `main-{{ .sha | trunc 7 }}`, auto-sync; CI check that its tag matches the built tag.
- [ ] Move/gate release-please so it runs **only** after a green stage E2E (drop the
      ungated push-to-`main` trigger, or chain via `workflow_run` on success).
- [ ] `e2e-scheduled.yml`: nightly full run vs stage, writes `e2e-main`, artifacts.
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
