# Performance testing & monitoring

This doc covers two things:

1. **Performance regression tests** already in the repo — what they guard and how to
   extend them.
2. **Recommended monitoring tools** for the Bubble stack, prioritised by leverage and
   grounded in what is *already* installed.

---

## 1. Performance regression tests

The item-list and facet endpoints are the hottest read paths (the header search popup
hits `facets`, every catalog page hits the list). Past regressions there were **N+1
query growth** and **per-preset `COUNT` fan-out**. Those are now guarded by
query-count tests that fail loudly if the pattern comes back.

Location: `backend/bubble/items/tests/tests.py`

| Test class | Guards |
| --- | --- |
| `ItemListQueryCountTests` | Public list (`api:public-item-list`) — query count is constant as rows grow (no N+1 in `first_image` / `location_detail`). |
| `PrivateItemListQueryCountTests` | Authenticated "my items" list (`api:item-list`) — same N+1 guard for the owner path (`get_for_user` + `select_related("user", "location")` + `prefetch_related("images")`). |
| `FacetsQueryCountTests` | Search facets (`api:public-item-facets`) — query count is invariant both as **rows** grow *and* as **preset variety** grows, proving the single conditional-aggregation query hasn't reverted to a per-preset `.count()` loop. |

### How they work

Each test uses `CaptureQueriesContext` to count queries for a small dataset and a larger
one, then asserts the counts are **equal**. A growing count means a per-row (or
per-preset) query crept in.

```python
with CaptureQueriesContext(connection) as ctx:
    response = client.get(url, {"page_size": 100})
return len(ctx.captured_queries)
```

> **Note on the warmup call.** The first request in a fresh process pays one-time
> cold-cache queries (Django `ContentType` cache, guardian permission lookups). The
> tests do a throwaway call first so the two *measured* calls are both warm — otherwise
> the comparison is flaky by ±1 query. Keep that warmup if you add more of these.

### Running them

```bash
just tests                                   # full suite (Docker)
# or target the guards directly:
docker compose run --rm backend pytest bubble/items/tests/tests.py -k QueryCount
```

### Extending the coverage

Good next candidates for the same treatment — all serialize related objects per row and
are user-facing:

- **Item detail** (`api:public-item-detail`) — cheap to guard, high traffic.
- **Bookings list** — the `bookings` app has exclusion constraints and offer/counter-offer
  chains; a page of bookings that serializes item + user is a classic N+1 shape.
- **Books list** (`books` app) — `Book` extends `Item`; verify the join doesn't add a
  query per row.
- **Collections** — `Collection.objects.get_for_user` feeds the facets `collections`
  block; guard it if collection counts grow.

Pattern to copy: build N and 5·N rows, hit the endpoint inside `CaptureQueriesContext`,
assert equal counts, and keep the warmup call.

---

## 2. Recommended monitoring tools

Ordered by **leverage per unit of effort** for this stack (Django + DRF + Postgres +
Redis + Huey + React/Vite, deployed via Helm). The first two are essentially free
because the dependencies are already in the tree.

### Tier 0 — turn on what's already installed

#### Sentry Performance (backend tracing + profiling) — **highest leverage**

`sentry-sdk` is already a backend dependency and initialised in
`config/settings/production.py`, **but `SENTRY_TRACES_SAMPLE_RATE` defaults to `0.0`** —
so error reporting is on while *performance* monitoring is off. Turning it on gives you
per-transaction spans (view → ORM → cache → outbound HTTP), slow-endpoint dashboards,
and N+1 detection **in production**, with no new infrastructure.

- Set `SENTRY_TRACES_SAMPLE_RATE` to a small non-zero value in prod (start at `0.05`–`0.1`
  and tune by traffic/quota).
- Add the profiler and richer integrations in `sentry_sdk.init(...)`:

  ```python
  from sentry_sdk.integrations.django import DjangoIntegration

  sentry_sdk.init(
      dsn=SENTRY_DSN,
      integrations=[sentry_logging, DjangoIntegration(), RedisIntegration()],
      environment=env("SENTRY_ENVIRONMENT", default="prod"),
      traces_sample_rate=env.float("SENTRY_TRACES_SAMPLE_RATE", default=0.1),
      profiles_sample_rate=env.float("SENTRY_PROFILES_SAMPLE_RATE", default=0.0),
      send_default_pii=False,
  )
  ```

- The `DjangoIntegration` auto-instruments DB spans, so the same N+1 the query-count
  tests catch pre-merge shows up as a span pile-up post-merge.

The **frontend** already runs `Sentry.browserTracing` at `tracesSampleRate` 1.0 desktop /
0.1 mobile (`frontend/src/main.tsx`) — so you get Web Vitals (LCP/CLS/INP) and route
transactions today. Consider adding `Sentry.replayIntegration()` (session replay) for
reproducing slow/janky interactions, sampled low.

#### django-debug-toolbar — already wired for local dev

Enabled in `config/settings/local.py`. It's the fastest way to eyeball SQL count, query
time, and cache hits per request while developing. No change needed; just use the SQL
panel when touching a list/detail view.

### Tier 1 — local & CI profiling (catch regressions before prod)

#### django-silk — request/SQL profiler you can leave on in staging

Records every request with its SQL, timings, and a Python profile. Unlike debug-toolbar
it persists history, so you can compare a page's query profile across commits. Good on a
staging box or behind a staff-only flag.

#### nplusone / django-zen-queries — fail CI on N+1

The query-count tests guard *specific* endpoints. `nplusone` (or `django-zen-queries`)
catches N+1 **anywhere** by raising during tests when a lazily-loaded relation triggers a
per-row query. Add it to the test settings so new endpoints are covered without writing a
bespoke guard for each.

### Tier 2 — database observability (where the time actually goes)

The perf work so far has been ORM-level (indexes, `select_related`, aggregation). To keep
finding the next bottleneck you want Postgres telling you which statements are slow.

- **`pg_stat_statements`** — enable the extension (add to `shared_preload_libraries` in the
  Postgres Helm values). This is the single most useful DB signal: total time, calls, and
  mean time per normalised query.
- **PgHero** — a lightweight dashboard over `pg_stat_statements` + index/table stats
  (missing indexes, unused indexes, bloat, long-running queries). Runs as a small
  container; ideal for a self-hosted setup like this. (`pganalyze` is the heavier
  hosted alternative.)
- **`auto_explain`** — log `EXPLAIN` plans for queries over a threshold (e.g. 500 ms) so
  slow plans are captured with their plan, not just their text.

### Tier 3 — metrics & dashboards (Prometheus + Grafana)

You already deploy with Helm/Kubernetes, so a Prometheus + Grafana stack is the natural
home for time-series metrics and alerting:

- **`django-prometheus`** — exposes request latency/count, DB connection, and cache
  metrics at `/metrics`.
- **`postgres_exporter`** and **`redis_exporter`** — DB and cache internals.
- Grafana dashboards + alert rules (p95 latency, error rate, DB connection saturation,
  Redis memory). Wire alerts to the same channel as Sentry.

This tier is more setup than Tier 0–2, so do it once the app-level signals (Sentry, DB
stats) show you *what* to alert on.

### Background tasks (Huey)

The app runs a `huey` worker (see `compose.yaml`) on Redis. Monitor:

- Queue depth and task latency (Redis `LLEN` on the task list, exported via
  `redis_exporter`, or Huey's own signals).
- Failed/retried tasks — route Huey exceptions into Sentry so a stuck image-generation or
  federation task surfaces the same place as web errors.

### Frontend

- **Sentry browser tracing** — already on; watch Core Web Vitals in the Sentry
  Performance view.
- **`web-vitals`** — if you want vitals independent of Sentry (or fed to another sink),
  the tiny `web-vitals` lib reports LCP/CLS/INP from real users.
- **Lighthouse CI** — run against a preview build in CI to catch bundle-size / render
  regressions before merge. Pairs well with the image-optimisation work already on this
  branch (thumbnail/preview sizing).

### Load / stress testing

The query-count tests prove *shape* (no N+1); load tests prove *throughput and latency
under concurrency*. Recommended for the endpoints already optimised here:

- **k6** (Grafana) — scriptable in JS, first-class latency percentiles, easy CI
  integration and thresholds (`http_req_duration p(95) < 300`). Recommended default.
- **Locust** — Python-native (fits the backend team's language); nice web UI for
  interactive ramp-ups.

Target the item list, item detail, and `facets` endpoints with a realistic mix of filter
params. Run against a staging DB seeded with representative row counts — a fast query on
100 rows can still be slow on 100k without the right index.

---

## Suggested adoption order

| Step | Effort | Payoff |
| --- | --- | --- |
| 1. Set `SENTRY_TRACES_SAMPLE_RATE` > 0 + add profiling in prod | Minutes (config) | Production APM, N+1 & slow-endpoint visibility |
| 2. Add `nplusone` to test settings | ~1 hr | CI catches N+1 everywhere, not just guarded endpoints |
| 3. Enable `pg_stat_statements` + PgHero | ~half day | See the actual slow queries |
| 4. Add a k6 script for list/detail/facets | ~half day | Latency-under-load baseline + regression gate |
| 5. Prometheus + Grafana + exporters | 1–2 days | Long-term metrics & alerting |

Steps 1–2 are near-free given the dependencies already present and should come first.
