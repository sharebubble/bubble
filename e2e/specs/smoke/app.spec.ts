import { expect, test } from '../../fixtures';
import { AuthPage } from '../../pages/AuthPage';
import { IndexPage } from '../../pages/IndexPage';

/**
 * Unauthenticated smoke: the deployed app serves HTML, boots React, and gates
 * behind login (default REQUIRE_LOGIN). No seeded data required — this is the
 * fast, always-green signal that the environment is up and serving the build.
 */
test.describe('@smoke app shell', () => {
  test('home responds and boots the React app', async ({ page }) => {
    const response = await page.goto('/');
    expect(response, 'navigation returned a response').not.toBeNull();
    expect(response!.status(), 'home returns a success status').toBeLessThan(400);

    const index = new IndexPage(page);
    expect(await index.isLoaded()).toBe(true);
  });

  test('unauthenticated visitor is shown the login form', async ({ page }) => {
    await page.goto('/');
    const auth = new AuthPage(page);
    await expect(auth.passwordInput.first()).toBeVisible();
  });
});
