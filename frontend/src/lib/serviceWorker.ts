/**
 * Service worker lifecycle, kept out of React so `main.tsx` can register before
 * the app mounts and any component can subscribe afterwards.
 *
 * The worker itself lives in `src/sw/service-worker.js` and is emitted as
 * `/sw.js` by the `pwa-service-worker` Vite plugin.
 */

type UpdateListener = (waiting: ServiceWorker | null) => void;

const listeners = new Set<UpdateListener>();

/** The worker that has installed and is waiting to take over, if any. */
let waitingWorker: ServiceWorker | null = null;

/** Guards against the reload loop that `controllerchange` can otherwise cause. */
let reloading = false;

/** Set once the user has accepted an update, so the swap may reload the page. */
let updateRequested = false;

const isSupported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

const setWaiting = (worker: ServiceWorker | null) => {
  if (waitingWorker === worker) return;
  waitingWorker = worker;
  listeners.forEach(listener => listener(worker));
};

/** Subscribe to "a new version is installed and waiting". Returns an unsubscribe. */
export function onServiceWorkerUpdate(listener: UpdateListener): () => void {
  listeners.add(listener);
  // Registration may already have found a waiting worker before this mounted.
  listener(waitingWorker);
  return () => listeners.delete(listener);
}

/**
 * Hand over to the waiting worker and reload once it controls the page.
 *
 * The worker never calls `skipWaiting()` on its own: replacing the shell while a
 * tab is running would leave that tab requesting lazy chunks the new build no
 * longer has. Swapping only on an explicit user action keeps that safe.
 */
export function applyServiceWorkerUpdate() {
  updateRequested = true;
  if (!waitingWorker) {
    window.location.reload();
    return;
  }
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
}

/**
 * Drop cached uploads on sign-out. Build output is not user-scoped, so the shell
 * and asset caches are left alone — only /media/ responses can belong to a
 * community the next user of this device is not part of.
 */
export function clearCachedMedia() {
  if (!isSupported()) return;
  navigator.serviceWorker.controller?.postMessage({ type: 'CLEAR_MEDIA_CACHE' });
}

/** True when the app is running as an installed PWA rather than a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS Safari predates `display-mode` and exposes a non-standard flag instead.
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return (
    iosStandalone ||
    window.matchMedia('(display-mode: standalone), (display-mode: minimal-ui)').matches
  );
}

/**
 * Register `/sw.js` in production builds only.
 *
 * In dev the worker would sit between Vite and the browser and serve a stale
 * shell; the dev server answers /sw.js with a stub that unregisters itself
 * instead, so a developer who previously loaded the deployed app on the same
 * origin recovers automatically (see `serviceWorkerPlugin` in vite.config.ts).
 */
export function registerServiceWorker() {
  if (!isSupported()) return;

  if (!import.meta.env.PROD) {
    // Fetching the dev stub is what triggers the teardown, so an existing
    // registration still needs an update check.
    navigator.serviceWorker
      .getRegistrations()
      .then(registrations => registrations.forEach(registration => registration.update()))
      .catch(() => {});
    return;
  }

  // A worker was already in charge when this page loaded, so any later change of
  // controller means a genuinely new build took over.
  const hadController = navigator.serviceWorker.controller !== null;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The first-ever install also fires this, because the worker claims open
    // clients on activate — reloading there would throw away a page the user is
    // already using, for a worker that has replaced nothing. Reload only when the
    // user accepted an update, or when a different worker replaced ours (a swap
    // accepted in another tab), since this page's assets are then stale.
    if (!updateRequested && !hadController) return;
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(registration => {
        if (registration.waiting && navigator.serviceWorker.controller) {
          setWaiting(registration.waiting);
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;

          installing.addEventListener('statechange', () => {
            // `controller` is null on the very first install, where there is
            // nothing to replace and so nothing to prompt about.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              setWaiting(installing);
            }
          });
        });

        // Catch updates deployed while a long-lived tab stays open.
        window.setInterval(
          () => {
            registration.update().catch(() => {});
          },
          60 * 60 * 1000,
        );
      })
      .catch(error => {
        // Registration failing must never be fatal: the app works without it.
        console.warn('[sw] registration failed:', error);
      });
  });
}
