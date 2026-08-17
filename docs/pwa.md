# PWA & service worker

Bubble is installable and stays usable on a flaky connection. This is how the
pieces fit together, and which trade-offs were made deliberately.

## Moving parts

| File                                     | Role                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `frontend/src/sw/service-worker.js`      | The worker itself. Plain JS, runs outside the bundle.                         |
| `frontend/vite.config.ts`                | `serviceWorkerPlugin()` emits `dist/sw.js` with the build's real asset URLs.  |
| `frontend/src/lib/serviceWorker.ts`      | Registration, update handover, cache purge on sign-out, standalone detection. |
| `frontend/src/hooks/useInstallPrompt.ts` | Wraps `beforeinstallprompt` so the app can offer "Install app".               |
| `frontend/public/manifest.json`          | Install metadata: icons, shortcuts, theme, scope.                             |
| `frontend/public/offline.html`           | Last-resort fallback when even the cached shell is unavailable.               |
| `frontend/nginx.default.conf.template`   | Serves `/sw.js` uncacheable; hashed assets immutable; icons for a week.       |
| `e2e/specs/smoke/pwa.spec.ts`            | `@smoke`: manifest, icons, `/sw.js` cache headers.                            |
| `e2e/specs/pwa/service-worker.spec.ts`   | `@regression`: install, precache, offline navigation, API bypass.             |

## Why the worker is generated, not hand-written

The precache list has to name the files the build actually produced, and those
filenames carry content hashes. The previous `public/sw.js` hard-coded
Create-React-App paths (`/static/js/bundle.js`, `/static/css/main.css`) that this
Vite build has never emitted. Since `cache.addAll()` is atomic, every install
rejected on the first 404 and the worker never activated — the app shipped a
service worker that did nothing at all for its whole life.

`serviceWorkerPlugin()` therefore walks the entry chunk's static import graph in
`generateBundle` and injects those URLs, plus the static shell files, into the
worker source. It also injects a build id (`GIT_SHA`, falling back to
`APP_VERSION` and then the build timestamp) that names the shell cache, so a
deploy's activate step drops the previous build's cache.

Workbox / `vite-plugin-pwa` would do the same job. It was not adopted because the
worker needs bespoke bypass rules for this deployment (Django under `/api/`,
`/accounts/`, `/admin/`, `/caldav/`, `/static/`, the Sentry tunnel,
`/env-config.js`, `/version.json`) and the whole worker is ~200 lines of explicit
policy — cheaper to read than a generated config, and one less dependency.

## Caching policy

| Request                                                                                   | Strategy                                      |
| ----------------------------------------------------------------------------------------- | --------------------------------------------- |
| Non-GET, cross-origin, range requests                                                     | Not intercepted                               |
| API, auth, admin, caldav, Django static, Sentry tunnel, `/env-config.js`, `/version.json` | Not intercepted                               |
| Navigations                                                                               | Network-first → cached shell → `offline.html` |
| `/assets/*`, `/lib/wasm/*` (hashed)                                                       | Cache-first, capped at 160 entries            |
| `/media/*` (uploads)                                                                      | Stale-while-revalidate, capped at 80 entries  |
| Other same-origin GETs (icons, manifest)                                                  | Stale-while-revalidate                        |

Navigations are deliberately **not** cache-first. The entry HTML points at
content-hashed bundles, so a cached `index.html` outliving its assets is exactly
the "stale-cache surprise" that makes a deploy look like a white screen.

`/media/` is only same-origin when media is served by nginx. Deployments with
`S3_CUSTOM_DOMAIN` hand out cross-origin URLs, which the worker leaves alone.

## Updates

The worker never calls `skipWaiting()` on its own: swapping the shell under a
running tab leaves it asking for lazy chunks the new build no longer has.

1. A new build installs and parks in `waiting`.
2. `onServiceWorkerUpdate` notifies the app; `AppUpdatePrompt` shows a sticky
   notification with a reload action.
3. Accepting posts `SKIP_WAITING`; the worker takes over, `controllerchange`
   fires, and the page reloads exactly once.

Registration also re-checks for updates hourly, for tabs left open for days.

The first install fires `controllerchange` too, because the worker claims open
clients on activate. Reloading there would throw away a page the user is already
using, so the reload only happens when the user accepted an update or when a
worker replaced the one this page started with (a swap accepted in another tab).

## Serving rules that matter

`/sw.js` must never be cached. It lives at the site root, so the generic
"every `.js` for a year, immutable" rule matched it, which pins whichever worker
a device installed first and makes every later deploy invisible to that device.
The exact-match `location = /sw.js` is what keeps it out of that rule — the
`@smoke` spec guards it.

Security headers moved to `frontend/nginx.security-headers.conf`, included from
each location. nginx's `add_header` does not inherit into a location that sets any
header of its own, so the asset location had been serving JS and images with no
CSP at all.

## Development

`npm run dev` never registers the worker; the dev server answers `/sw.js` with a
stub that clears Bubble's caches and unregisters itself. A developer who once
loaded the deployed app on the same origin recovers on the next load instead of
being served a stale shell by a worker Vite knows nothing about.

To exercise the real worker locally:

```bash
npm run build --prefix frontend
npx vite preview --prefix frontend   # or any static server; service workers need one
```

## Known gaps

- **No push notifications.** Booking requests and messages would be a natural
  fit, but it needs VAPID keys plus subscription endpoints on the backend; the
  worker has no `push` handler yet.
- **No `screenshots` in the manifest.** The entries that were there pointed at
  files that had never been committed, so they were removed. Adding real ones
  unlocks Chromium's richer install dialog.
- **Background sync** is not used: an action taken offline fails rather than
  queueing.
