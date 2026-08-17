# PWA & service worker

Bubble is installable and stays usable on a flaky connection. This is how the
pieces fit together, and which trade-offs were made deliberately.

## Moving parts

| File                                                         | Role                                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `frontend/src/sw/service-worker.js`                          | The worker itself. Plain JS, runs outside the bundle.                         |
| `frontend/vite.config.ts`                                    | `serviceWorkerPlugin()` emits `dist/sw.js` with the build's real asset URLs.  |
| `frontend/src/lib/serviceWorker.ts`                          | Registration, update handover, cache purge on sign-out, standalone detection. |
| `frontend/src/hooks/useInstallPrompt.ts`                     | Wraps `beforeinstallprompt` so the app can offer "Install app".               |
| `frontend/public/manifest.json`                              | Install metadata: icons, shortcuts, theme, scope.                             |
| `frontend/public/offline.html`                               | Last-resort fallback when even the cached shell is unavailable.               |
| `frontend/nginx.default.conf.template`                       | Serves `/sw.js` uncacheable; hashed assets immutable; icons for a week.       |
| `e2e/specs/smoke/pwa.spec.ts`                                | `@smoke`: manifest, icons, `/sw.js` cache headers.                            |
| `e2e/specs/pwa/service-worker.spec.ts`                       | `@regression`: install, precache, offline navigation, API bypass.             |
| `backend/bubble/notifications/webpush.py`                    | VAPID keys, subject normalisation, "is push usable here".                     |
| `backend/bubble/notifications/providers/webpush_provider.py` | One send, and whether a failure means "gone".                                 |
| `backend/bubble/notifications/api/push_views.py`             | subscribe / unsubscribe / status / test endpoints.                            |
| `frontend/src/lib/push.ts`                                   | Permission, subscribe, and revoking on sign-out.                              |

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

## Push notifications

Push is a second transport for the notifications Bubble already sends (new
message, new booking, new item), reaching a user whose tab is closed. It rides on
the existing `NotificationPreference` machinery as one more provider,
`webpush`, alongside the Apprise channels.

### Setup

Push stays completely disabled until a VAPID keypair is configured — the settings
UI hides itself, the subscribe endpoint answers 503, and the dispatcher skips the
channel. To turn it on:

```bash
python manage.py generate_vapid_keys   # or: just manage generate_vapid_keys
```

That prints the two values to set:

| Variable            | Secret? | Where                                              |
| ------------------- | ------- | -------------------------------------------------- |
| `VAPID_PUBLIC_KEY`  | No      | `backend.django` in Helm values / compose env      |
| `VAPID_PRIVATE_KEY` | **Yes** | `backend.secrets.vapidPrivateKey` / compose env    |
| `VAPID_SUBJECT`     | No      | Optional; defaults to `mailto:$DEFAULT_FROM_EMAIL` |

`VAPID_SUBJECT` is how a push service reaches the _operator_ if this deployment
starts misbehaving — it is signed into every push and never shown to users. RFC
8292 allows only a `mailto:` URI or an `https:` URL, and push services enforce it
with a 403.

You can leave it unset: it falls back to `DEFAULT_FROM_EMAIL`. Anything
address-shaped is normalised, including the display-name form `production.py`
ships (`bubble <noreply@sharebubble.org>` → `mailto:noreply@sharebubble.org`),
since a `mailto:` URI cannot contain a display name or spaces. An `http:` URL or
something that is not an address at all is rejected with a warning, which leaves
push disabled rather than failing on every send later.

**Generating a new keypair invalidates every existing subscription.** Browsers
subscribe _against_ the public key and push services reject anything signed with
a different one, so users have to re-enable notifications. Generate once per
environment and keep the private key with your other secrets; the command refuses
to overwrite a configured key without `--force`.

### How a device opts in

Two independent things must be true before anyone is notified: the browser holds a
subscription, and the account has the `webpush` event toggles on. The split is
deliberate — the device grant is local and revocable per device, the event choice
belongs to the account.

1. `GET /api/config/` hands the frontend `VAPID_PUBLIC_KEY`.
2. "Enable on this device" requests notification permission and calls
   `pushManager.subscribe()`, then posts the subscription to
   `POST /api/push-subscriptions/subscribe/` (`src/lib/push.ts`).
3. Enabling also switches the `messages` event group on, so a device that opted
   in actually receives something.
4. `POST /api/push-subscriptions/test/` sends a test notification — the only way
   to check the keys, the push service and the worker's handler all agree.

Signing out revokes this browser's subscription _before_ the session ends
(`revokePushOnSignOut`). Without that, the next person to sign in on a shared
browser would inherit a subscription still registered to the previous account.

### Delivery

`dispatch_notification` already runs for every notifiable event; the `webpush`
branch enqueues `deliver_web_push`, which resolves the user's devices at send time
and fans out through `pywebpush`.

- A push service answering **404/410** means the subscription is gone for good, so
  the row is deleted. That is the only cleanup path — browsers never tell the
  server when they drop one.
- Any other failure (timeout, 5xx, 429) is transient and keeps the row.
- The click target is a relative in-app path (`notification_path`), so the worker
  can focus an already-open tab instead of opening a second window.

The worker **suppresses a notification when a visible tab already has the app
open**, because that tab has already shown an in-app toast over the WebSocket.
The user-requested test notification is exempt.

### Testing it locally

Push needs a real push service, so it cannot be exercised against `localhost`
alone — but everything up to the send can be:

```bash
just manage generate_vapid_keys       # set the printed values, restart the stack
```

Then enable notifications in Profile → Notifications and use "Send test". Chromium
also lets you deliver a synthetic push from DevTools → Application → Service
Workers → Push.

## Known gaps

- **No `screenshots` in the manifest.** The entries that were there pointed at
  files that had never been committed, so they were removed. Adding real ones
  unlocks Chromium's richer install dialog.
- **Background sync** is not used: an action taken offline fails rather than
  queueing.
- **iOS needs the app installed.** Safari only exposes the Push API to a PWA added
  to the home screen, so the settings block is hidden in the iOS browser.
- **No per-device management UI.** A user can enable or disable the device they
  are on; older devices are only visible (and removable) in the Django admin.
