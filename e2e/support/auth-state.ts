import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Browser, BrowserContext } from '@playwright/test';

import type { Role } from './config';

const HERE = dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = resolve(HERE, '../.auth');

/** Filesystem path of the persisted storageState for a role. */
export function roleStatePath(role: Role): string {
  return resolve(AUTH_DIR, `${role}.json`);
}

export function ensureAuthDir(): void {
  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true });
  }
}

/** Open a browser context authenticated as `role` from its saved storageState. */
export async function contextForRole(browser: Browser, role: Role): Promise<BrowserContext> {
  const statePath = roleStatePath(role);
  if (!existsSync(statePath)) {
    throw new Error(
      `No saved auth state for role "${role}" (${statePath}). ` +
        'The `setup` project must run first and credentials must be configured.',
    );
  }
  return browser.newContext({ storageState: statePath });
}
