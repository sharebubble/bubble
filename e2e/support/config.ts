/**
 * Centralised, validated environment configuration for the E2E suite.
 *
 * Precedence: real env vars > defaults. Secrets (user credentials) are read
 * lazily and only required by the code paths that use them, so `--list` and
 * typechecks work without them. See e2e/.env.example for the full list.
 */

function optional(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. See e2e/.env.example; export it or add it to e2e/.env.`,
    );
  }
  return value;
}

const baseURL = optional('E2E_BASE_URL', 'https://main.sharebubble.org').replace(/\/$/, '');

export const env = {
  /** Frontend base URL under test. */
  baseURL,
  /** API base URL — defaults to the same origin as the frontend. */
  apiURL: optional('E2E_API_URL', baseURL).replace(/\/$/, ''),
  /** Namespace tag for any data this run creates, for safe isolated cleanup. */
  runId: optional('E2E_RUN_ID', optional('GITHUB_RUN_ID', `local-${process.pid}`)),
};

/** Roles in the multi-user pool. Extend as flows require more actors. */
export const ROLES = ['owner', 'renterA', 'renterB', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Credentials for a pooled role, read from env on demand:
 *   E2E_OWNER_USERNAME / E2E_OWNER_PASSWORD, E2E_RENTERA_USERNAME, ...
 */
export function credentialsFor(role: Role): { username: string; password: string } {
  const key = role.toUpperCase();
  return {
    username: required(`E2E_${key}_USERNAME`),
    password: required(`E2E_${key}_PASSWORD`),
  };
}

/** True when every pooled role has credentials configured. */
export function hasAllCredentials(): boolean {
  return ROLES.every(
    role =>
      process.env[`E2E_${role.toUpperCase()}_USERNAME`] &&
      process.env[`E2E_${role.toUpperCase()}_PASSWORD`],
  );
}
