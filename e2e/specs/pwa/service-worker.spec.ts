import { expect, test } from '../../fixtures';
import { IndexPage } from '../../pages/IndexPage';

/**
 * The service worker's runtime behaviour: it must take control, precache the app
 * shell, keep serving that shell when the connection drops, and never answer an
 * API call from cache.
 *
 * In the regression tier rather than smoke because it drives a real browser
 * through install/activate and toggles the network. Chromium only: the worker is
 * feature-detected, and this is the browser the suite runs.
 */
test.describe('@regression service worker', () => {
  test('takes control of the page and precaches the app shell', async ({ page }) => {
    await page.goto('/');

    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, {
      timeout: 30_000,
    });

    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const shell = names.find(name => name.startsWith('bubble-shell-'));
      if (!shell) return null;
      const requests = await (await caches.open(shell)).keys();
      return requests.map(request => new URL(request.url).pathname);
    });

    expect(cached, 'a versioned shell cache exists').not.toBeNull();
    expect(cached, 'entry document is precached').toContain('/index.html');
    expect(cached, 'offline fallback is precached').toContain('/offline.html');
    expect(
      cached?.some(path => path.startsWith('/assets/')),
      'hashed build output is precached',
    ).toBe(true);
  });

  test('serves the app shell offline and still refuses to cache the API', async ({
    context,
    page,
  }) => {
    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, {
      timeout: 30_000,
    });

    await context.setOffline(true);
    try {
      const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
      expect(response, 'offline navigation is answered by the worker').not.toBeNull();

      const index = new IndexPage(page);
      expect(await index.isLoaded(), 'app shell mounts while offline').toBe(true);

      // Serving a cached API response would silently show stale items, bookings
      // and messages, so the worker must let the request fail instead.
      const apiResult = await page.evaluate(async () => {
        try {
          const response = await fetch('/api/version/', { cache: 'no-store' });
          return `resolved ${response.status}`;
        } catch {
          return 'rejected';
        }
      });
      expect(apiResult, '/api/ is never served from cache').toBe('rejected');
    } finally {
      await context.setOffline(false);
    }
  });
});
