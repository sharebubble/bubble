import { defineConfig, devices } from '@playwright/test';

import { env } from './support/config';

/**
 * Playwright configuration for Bubble E2E.
 *
 * The suite targets a *deployed* environment (default: main.sharebubble.org, the
 * stage env used as the release gate — see docs/e2e-testing/plan.md). `baseURL`
 * and the API URL come from env so the same specs run locally, on stage, and in
 * the release-gate pipeline with no code change.
 *
 * Test tiers are expressed as @smoke / @regression / @destructive tags in titles
 * and selected with `--grep`. The `setup` project authenticates the user pool
 * once and persists a storageState per role for the browser projects to reuse.
 */
export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
  ],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: env.baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
  },
  projects: [
    // Authenticates the pooled users once; writes .auth/<role>.json storageState.
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Escape hatch for environments with a pinned/preinstalled browser whose
        // build differs from this Playwright version (set to the chromium binary).
        launchOptions: process.env.PW_EXECUTABLE_PATH
          ? { executablePath: process.env.PW_EXECUTABLE_PATH }
          : {},
      },
      dependencies: ['setup'],
    },
  ],
});
