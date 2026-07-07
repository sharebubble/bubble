# Plan: AI E2E Test Generator & Adaptation (Phase B)

> Deferred to a follow-up PR. The harness (Phase A), data lifecycle (Phase C),
> version guard, stage E2E workflow, and the release-please gate (Phase D) are
> already implemented on the `e2e/` workspace. This document is the actionable
> plan for the remaining piece: an AI job that **writes and maintains** the
> Playwright specs so coverage tracks the app automatically. It expands §5 of
> [`plan.md`](./plan.md); read that first for the overall architecture.

## 1. Goal

An AI-driven job (Claude) that keeps `e2e/` in sync with the application:

- **Discovers** app functionality from authoritative, machine-readable sources.
- **Writes/updates** page objects and specs following `e2e/AGENTS.md`.
- **Self-verifies** each generated spec against a disposable stack before proposing it.
- **Adapts** automatically when features change (on merge, nightly, on flake).
- Only ever opens **PRs** (labeled `e2e-generated`); humans/auto-merge policy approve.

Non-goal: replacing the hand-written `@smoke` tier or the release gate — those stay
authoritative. The generator scales `@regression` coverage on top of a proven harness.

## 2. What exists to build on

- `e2e/` Playwright workspace: `fixtures.ts`, `support/` (config, api client with
  item/booking helpers + `authedApi` actor factory, namespace, auth-state,
  test-data tracker), `pages/` POMs, `specs/` tiers (`@smoke`/`@regression`).
- `e2e/AGENTS.md`: the authoring contract the generator MUST follow.
- Backend `seed_e2e`/`purge_e2e` commands + the `E2E_ALLOW` guard.
- `GET /api/version` + `/version.json` + the `wait-for-version.mjs` guard.
- CI: `e2e.yml` runs the suite against stage and gates release-please.

## 3. Discovery inputs (deterministic — the generator reads these, does not guess)

1. **Backend OpenAPI schema** (`/api/schema/`, drf-spectacular): every endpoint,
   method, request/response shape, permissions — the authoritative "what the app
   can do". This is the primary work-list source.
2. **Frontend route tree** (`frontend/src/App.tsx` `<Route>`s): the page surface
   and which routes are `<AuthRequired>`.
3. **React Query hooks** (`frontend/src/hooks/`): maps UI actions → API calls so
   specs assert the right side effects (e.g. `useItems`, `useBookings`).
4. **Existing `e2e/` suite + coverage**: what is already covered, to write only the
   delta and avoid duplicates.

A deterministic **discovery script** produces a coverage work-list:
`{endpoint|route} → covered? → suggested spec`. This is plain code (no AI), so it is
cheap and repeatable; the AI only authors the uncovered items.

## 4. Generation loop (Claude + Playwright MCP)

For each uncovered feature/flow:

1. Claude drafts a **page object** (if the surface is new) + a **spec**, from the
   discovery inputs and `e2e/AGENTS.md` conventions.
2. Claude drives the **Playwright MCP** against a disposable stack (`just up` in CI,
   seeded via `seed_e2e`) to **self-verify**: run the draft, read failures/traces,
   iterate until green. Only specs that actually pass are kept.
3. When a stable selector is missing, Claude adds a `data-testid` to the relevant
   React component **in the same PR** (small, reviewable frontend diffs).
4. Output: a **pull request** labeled `e2e-generated`, with a summary of new/changed
   coverage and which discovery items it closed.

Guardrails: PR-only; self-verification is mandatory; `@smoke` stays tiny and stable;
diff-mode by default; cost/scope caps (see §6).

## 5. Adaptation triggers (keeping tests current)

- **On merge to `main` touching `frontend/**`, `backend/**`, or the OpenAPI schema**
  → generator in *diff mode*: regenerate only affected specs, open a PR. This is how
  tests "adapt when new features arrive".
- **Nightly full reconciliation** → detect drift (routes/endpoints with no test;
  specs hitting removed endpoints) and open one housekeeping PR.
- **On repeated flake/failure of an existing spec** (from `e2e.yml` history) → a
  *repair* run: Claude reads the trace and proposes a fix, labeling whether it's
  selector drift vs. a real regression.

## 6. Runner & implementation options (decide in the PR)

- **Runner**: Claude Code in a scheduled/dispatched GitHub Action (Claude Code GitHub
  app or the `claude` CLI), or the Agent SDK. Needs `ANTHROPIC_API_KEY` (GitHub
  secret) and the Playwright MCP configured against the CI stack.
- **Disposable stack for self-verify**: `just up` in the workflow, `seed_e2e` for the
  user pool, `purge_e2e` after. (Keep this separate from stage — never self-verify
  against `main.sharebubble.org`.)
- **Cost caps**: diff-mode on merges; full regen only nightly; per-run agent/scope
  limits; log what was skipped so silent truncation can't masquerade as coverage.
- **Merge policy**: `e2e-generated` PRs require green CI; consider auto-merge only for
  `@smoke`-free, green, POM-additive diffs — everything else human-reviewed.

## 7. Deliverables checklist (for the follow-up PR)

- [ ] `e2e/scripts/discover.mjs` — OpenAPI + routes + hooks + existing-coverage → work-list.
- [ ] Generator workflow (`.github/workflows/e2e-generate.yml`): on-merge diff-mode,
      nightly full, manual dispatch; `ANTHROPIC_API_KEY`; Playwright MCP; PR-only.
- [ ] Self-verification harness: spin up `just up`, `seed_e2e`, run drafts, iterate.
- [ ] Flake/repair path wired to `e2e.yml` run history/artifacts.
- [ ] `data-testid` backfill convention + initial critical-path testids
      (auth form, item card, create-item form, booking actions).
- [ ] Tighten `e2e/AGENTS.md` with any conventions discovered while building the generator.

## 8. Risks (recap from plan §10, generator-specific)

- **Flaky/incorrect AI tests** → mandatory self-verify (only green specs committed),
  PR-only, small stable `@smoke` tier.
- **Selector fragility (Mantine)** → `data-testid` policy; generator adds them in-PR.
- **Runaway cost** → diff-mode default, nightly-only full regen, scope caps + logging.
- **Never self-verify against stage/prod** → disposable `just up` stack only.
