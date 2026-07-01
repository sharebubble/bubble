import { test as setup } from '@playwright/test';

import { ApiClient } from '../support/api';
import { ensureAuthDir, roleStatePath } from '../support/auth-state';
import { credentialsFor, env, hasAllCredentials, ROLES } from '../support/config';

/**
 * Authenticate every pooled user once and persist a storageState per role, which
 * the browser projects reuse (fast, parallel-safe). Runs as the `setup` project,
 * a dependency of the browser projects (see playwright.config.ts).
 *
 * Skipped when credentials are not configured, so `--list`, local dry-runs, and
 * typechecks work without secrets — the browser projects that need a role will
 * then fail loudly with a clear message from contextForRole().
 */
setup('authenticate user pool', async ({ playwright }) => {
  setup.skip(!hasAllCredentials(), 'E2E_<ROLE>_USERNAME/PASSWORD not configured');

  ensureAuthDir();

  for (const role of ROLES) {
    const context = await playwright.request.newContext({ baseURL: env.apiURL });
    const api = new ApiClient(context, env.apiURL);
    const { username, password } = credentialsFor(role);

    await api.login(username, password);
    await context.storageState({ path: roleStatePath(role) });
    await context.dispose();
  }
});
