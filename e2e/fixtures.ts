import { test as base } from '@playwright/test';

import { ApiClient } from './support/api';
import { env } from './support/config';
import { TestData } from './support/test-data';

/**
 * Extended Playwright `test` with Bubble-specific fixtures:
 *  - `api`      — an (unauthenticated) API client bound to the API URL; call
 *                 `api.login(...)` to authenticate it for the current test.
 *  - `testData` — a run-scoped resource tracker that auto-cleans after the test.
 *
 * Import `test` and `expect` from here instead of `@playwright/test`.
 * For authenticated *browser* work, use `contextForRole()` from
 * support/auth-state.ts, backed by the storageState the `setup` project writes.
 */
export const test = base.extend<{ api: ApiClient; testData: TestData }>({
  api: async ({ playwright }, use) => {
    const context = await playwright.request.newContext({ baseURL: env.apiURL });
    await use(new ApiClient(context, env.apiURL));
    await context.dispose();
  },

  testData: async ({}, use) => {
    const data = new TestData();
    await use(data);
    await data.cleanup();
  },
});

export { expect } from '@playwright/test';
