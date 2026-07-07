# E2E authoring contract (humans + AI generator)

House style for everything under `e2e/`. The AI generator (plan §5) MUST follow
these; reviewers reject diffs that don't.

## Structure

- **Page Object Models** in `pages/`, one per route/surface, extending `BasePage`.
  Specs never contain raw selectors — expose intent-revealing methods/locators on
  the page object instead.
- **Specs** in `specs/<domain>/`, importing `test`/`expect` from `../../fixtures`
  (not `@playwright/test`), so the `api` and `testData` fixtures are available.
- **Tiers via tags** in the describe/test title:
  - `@smoke` — fast (<2 min total), no seeded data, must always pass. Release gate.
  - `@regression` — full coverage; may seed data. Release gate.
  - `@destructive` — deletes/mutates; operates ONLY on data it created this test.

## Selectors

- Prefer `data-testid` via `page.getByTestId(...)`. If a needed testid is missing,
  add it to the React component in the SAME PR (small, reviewable) rather than
  reaching for brittle text/CSS selectors.
- Allowed fallbacks (in order): role-based (`getByRole`), label, then structural.
  Never assert on Mantine-generated class names.

## Data & users

- Create test data through the API (`api`) or the seed command, never by assuming
  pre-existing records. Tag everything with the run namespace (`namespaced()` /
  `NAMESPACE` from `support/namespace.ts`).
- Register cleanup for every created resource via `testData.remember(...)` so it is
  removed even if the test fails. Do not rely on the nightly janitor as primary
  cleanup — it is only a backstop.
- Multi-actor flows use the pooled roles (`owner`, `renterA`, `renterB`, `admin`)
  via `contextForRole()`; never register ad-hoc users inside a test.
- No hard-coded production data, IDs, emails, or credentials. Secrets come from env.

## Assertions & stability

- Use web-first assertions (`await expect(locator).toBeVisible()`), never manual
  sleeps. Assert on user-visible outcomes AND, where relevant, the API side effect.
- Each test must be independent and idempotent — runnable in isolation, in any
  order, in parallel.

## Generator-specific rules

- Discover features from the OpenAPI schema, the React route tree, and the hooks —
  not from guesswork. Cover the happy path, negative/edge cases, and multi-user
  cases (see the coverage matrix in plan §6.4).
- Self-verify: a generated spec is only committed after it passes against a
  disposable stack. Open a PR labeled `e2e-generated`; never push to main directly.
- Keep the `@smoke` tier tiny and stable; put slower/broader cases in `@regression`.
