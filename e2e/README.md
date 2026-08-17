# Bubble E2E (Playwright)

End-to-end tests that run against a **deployed** environment and act as the
release gate (default target: `https://main.sharebubble.org`, the stage env).
See [`docs/e2e-testing/plan.md`](../docs/e2e-testing/plan.md) for the full design.

## Layout

```
e2e/
  playwright.config.ts   # projects (setup + chromium), baseURL from env
  fixtures.ts            # extended `test`: api + testData fixtures
  support/               # config, api client, namespace, auth-state, test-data
  pages/                 # Page Object Models (BasePage, AuthPage, IndexPage, ...)
  specs/                 # tests, tagged @smoke / @regression / @destructive
    auth.setup.ts        # logs in the user pool → .auth/<role>.json storageState
    smoke/               # fast, always-green, no seeded data
  scripts/
    wait-for-version.mjs # release-gate version guard (poll until stage serves <sha>)
```

## Running

```bash
cd e2e
npm ci

# against stage (default), no creds needed for smoke:
npm run test:smoke

# against a local stack:
just e2e-up                                        # build, start, seed (see below)
E2E_BASE_URL=http://localhost:8080 npm run test:smoke

# full suite (needs the user pool configured — see .env.example):
cp .env.example .env   # fill in E2E_<ROLE>_USERNAME/PASSWORD, or let `just e2e-up` do it
npm test
```

Browser projects depend on the `setup` project, which authenticates the pooled
users once and saves a `storageState` per role. Without credentials the setup is
skipped and only credential-free specs (e.g. `smoke/`) run.

## Local test deployment (`just e2e-up`)

`scripts/e2e-local-up.sh` (repo root) is the one-command base for running this
suite against a fresh local stack instead of stage:

```bash
just e2e-up                 # build + start docker compose, seed demo content + the E2E pool
just e2e-up --reset         # wipe volumes first for a clean DB
just e2e-up --no-build      # reuse existing images (faster iterative runs)
```

It builds and starts `docker compose`, waits for `/api/version/` to respond,
runs migrations, seeds realistic demo content (`manage.py seed_demo`), and — if
`e2e/.env` doesn't already have them — generates random credentials for the
`E2E_*` user pool and provisions them via `seed_e2e`. Safe to re-run: compose,
`seed_demo` and `seed_e2e` are all idempotent, and it never overwrites
credentials you've already configured. See `scripts/e2e-local-up.sh --help`
for all options.

## Test data: seed & purge (backend commands)

Two kinds of seed data, for two different purposes:

- **`seed_demo`** — a realistic, fixed cast (3 users, 16 items across every
  category/sales type, bookings with message threads, collections) so every
  page has real content to render against. Meant for local dev, screenshots,
  manual QA, and as a content baseline for specs that don't need the isolated
  multi-user pool. Idempotent; refuses to run unless `DEBUG` is on or
  `SEED_DEMO_ALLOW=1` is set, so it can't touch a real production DB by accident.
  ```bash
  python manage.py seed_demo             # create/update the demo dataset
  python manage.py seed_demo --flush     # wipe previously seeded demo data first
  python manage.py seed_demo --no-images # skip generating placeholder photos
  ```
- **`seed_e2e` / `purge_e2e`** — the namespaced multi-user pool (`owner`,
  `renterA`, `renterB`, `admin`) that `@regression` specs authenticate as, plus
  cleanup for anything a run creates. Both refuse to run unless `E2E_ALLOW=1`
  (so they can never hit production by accident):

  ```bash
  # provision/refresh the pool (reads the same E2E_<ROLE>_* env vars)
  E2E_ALLOW=1 <role env...> python manage.py seed_e2e

  # delete E2E-namespaced data (items cascade to bookings/messages/images)
  E2E_ALLOW=1 python manage.py purge_e2e            # all runs
  E2E_ALLOW=1 python manage.py purge_e2e --run-id X # one run
  E2E_ALLOW=1 python manage.py purge_e2e --dry-run  # preview
  E2E_ALLOW=1 python manage.py purge_e2e --users    # also remove the pool users
  ```

  Specs create only namespaced data (`E2E-<runId>::…`) and delete it at end of
  test; `purge_e2e` is the janitor backstop for anything a crashed run leaks.

## Version guard (CI)

```bash
node scripts/wait-for-version.mjs "$GITHUB_SHA"
```

Blocks until both the backend (`/api/version`) and frontend (`/version.json`)
report the commit under test, then exits 0 — so E2E never runs against a
half-finished rollout. Exits non-zero on timeout.

## CI workflow (`.github/workflows/e2e.yml`)

Runs against stage after CI succeeds on `main` (once ArgoCD has synced), on a
3-hourly schedule, and on manual dispatch. It resolves the latest `main` commit,
waits with the version guard until stage serves that exact SHA, then runs the
suite and uploads the HTML report.

For it to work, the deployed images must report their SHA (CI passes
`--build-arg GIT_SHA=${{ github.sha }}`), and a GitHub **Environment named `e2e`**
must provide:

- **Variables**: `E2E_BASE_URL` (optional; defaults to `https://main.sharebubble.org`).
- **Secrets**: `E2E_OWNER_USERNAME`/`E2E_OWNER_PASSWORD`, `E2E_RENTERA_*`,
  `E2E_RENTERB_*`, `E2E_ADMIN_*` — the pool you provisioned with `seed_e2e`.

Without the secrets the guard + `@smoke` still run; the `@regression` booking
flow skips. `schedule`/`workflow_run`/`workflow_dispatch` only fire once this
workflow is on the default branch.

## Conventions

Test authoring rules live in [`AGENTS.md`](./AGENTS.md); the AI generator and
humans both follow them.
