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

# against a local stack (just up):
E2E_BASE_URL=http://localhost:8080 npm run test:smoke

# full suite (needs the user pool configured — see .env.example):
cp .env.example .env   # fill in E2E_<ROLE>_USERNAME/PASSWORD
npm test
```

Browser projects depend on the `setup` project, which authenticates the pooled
users once and saves a `storageState` per role. Without credentials the setup is
skipped and only credential-free specs (e.g. `smoke/`) run.

## Version guard (CI)

```bash
node scripts/wait-for-version.mjs "$GITHUB_SHA"
```

Blocks until both the backend (`/api/version`) and frontend (`/version.json`)
report the commit under test, then exits 0 — so E2E never runs against a
half-finished rollout. Exits non-zero on timeout.

## Conventions

Test authoring rules live in [`AGENTS.md`](./AGENTS.md); the AI generator and
humans both follow them.
