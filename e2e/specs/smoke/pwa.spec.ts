import { expect, test } from '../../fixtures';

/**
 * Installability contract, at the HTTP level only so it stays in the smoke tier:
 * the manifest parses and every icon it advertises resolves, and /sw.js is served
 * uncacheable.
 *
 * That last check is the one with teeth. The worker sits at the site root, so the
 * generic "cache every .js for a year, immutable" rule used to match it, which
 * pins whichever worker a device installed first and makes every later deploy
 * invisible to it. The nginx config carves /sw.js out explicitly
 * (frontend/nginx.default.conf.template); this guards that carve-out.
 */

interface ManifestIcon {
  src: string;
  sizes?: string;
  type?: string;
  purpose?: string;
}

interface WebManifest {
  name?: string;
  short_name?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  theme_color?: string;
  background_color?: string;
  icons?: ManifestIcon[];
}

test.describe('@smoke pwa installability', () => {
  test('manifest is served and describes an installable app', async ({ request }) => {
    const response = await request.get('/manifest.json');
    expect(response.status(), 'manifest is reachable').toBe(200);

    const manifest = (await response.json()) as WebManifest;

    expect(manifest.name, 'name').toBeTruthy();
    expect(manifest.short_name, 'short_name').toBeTruthy();
    expect(manifest.start_url, 'start_url').toBeTruthy();
    expect(manifest.scope, 'scope').toBe('/');
    // Anything other than standalone/fullscreen is not installable as an app.
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display);
    expect(manifest.theme_color, 'theme_color').toBeTruthy();
    expect(manifest.background_color, 'background_color').toBeTruthy();

    const icons = manifest.icons ?? [];
    // Chromium requires a 192px and a 512px icon before it offers an install.
    const sizes = icons.map(icon => icon.sizes);
    expect(sizes, 'has a 192px icon').toContain('192x192');
    expect(sizes, 'has a 512px icon').toContain('512x512');
    expect(
      icons.some(icon => icon.purpose?.includes('maskable')),
      'has a maskable icon',
    ).toBe(true);
  });

  test('every icon the manifest advertises resolves', async ({ request }) => {
    const manifest = (await (await request.get('/manifest.json')).json()) as WebManifest;

    for (const icon of manifest.icons ?? []) {
      const response = await request.get(icon.src);
      expect(response.status(), `${icon.src} resolves`).toBe(200);
      expect(response.headers()['content-type'], `${icon.src} content type`).toContain('image/');
    }
  });

  test('service worker script is served uncacheable', async ({ request }) => {
    const response = await request.get('/sw.js');
    expect(response.status(), '/sw.js is reachable').toBe(200);

    const headers = response.headers();
    expect(headers['content-type'], 'served as JavaScript').toMatch(/javascript/);
    // A stale worker can never be replaced, so revalidation is mandatory.
    expect(headers['cache-control'], 'must be revalidated').toMatch(/no-store|no-cache/);
    expect(headers['cache-control'], 'must not be immutable').not.toContain('immutable');
  });

  test('offline fallback page is available', async ({ request }) => {
    const response = await request.get('/offline.html');
    expect(response.status(), '/offline.html is reachable').toBe(200);
  });
});
