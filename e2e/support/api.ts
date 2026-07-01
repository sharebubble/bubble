import type { APIRequestContext } from '@playwright/test';

/**
 * Thin API client over Bubble's backend, used for auth (allauth headless),
 * the version guard, and API-driven test-data setup/teardown.
 *
 * It wraps a Playwright APIRequestContext, which persists cookies (sessionid,
 * csrftoken) across calls — so after `login()` the same context is authenticated
 * and its `storageState()` can be saved for browser reuse.
 */
const ALLAUTH = '/api/_allauth/browser/v1/auth';

export interface VersionInfo {
  git_sha: string;
  version: string;
}

export class ApiClient {
  constructor(
    private readonly request: APIRequestContext,
    private readonly apiURL: string,
  ) {}

  /** GET /api/version/ — build info of the backend actually serving traffic. */
  async version(): Promise<VersionInfo> {
    const res = await this.request.get(`${this.apiURL}/api/version/`);
    if (!res.ok()) {
      throw new Error(`GET /api/version/ failed: ${res.status()}`);
    }
    return (await res.json()) as VersionInfo;
  }

  /** Prime a CSRF cookie by hitting the allauth session endpoint. */
  async csrfToken(): Promise<string> {
    await this.request.get(`${this.apiURL}${ALLAUTH}/session`);
    const state = await this.request.storageState();
    const cookie = state.cookies.find((c) => c.name === 'csrftoken');
    if (!cookie) {
      throw new Error('csrftoken cookie was not set by the session endpoint');
    }
    return cookie.value;
  }

  /** Log in via allauth headless; the context becomes authenticated on success. */
  async login(username: string, password: string): Promise<void> {
    const csrf = await this.csrfToken();
    const res = await this.request.post(`${this.apiURL}${ALLAUTH}/login`, {
      headers: { 'X-CSRFToken': csrf, 'Content-Type': 'application/json' },
      data: { username, password },
    });
    if (!res.ok()) {
      throw new Error(`Login failed for ${username}: ${res.status()} ${await res.text()}`);
    }
  }

  /** Log out the current session (best-effort). */
  async logout(): Promise<void> {
    const csrf = await this.csrfToken().catch(() => '');
    await this.request.delete(`${this.apiURL}${ALLAUTH}/session`, {
      headers: csrf ? { 'X-CSRFToken': csrf } : undefined,
    });
  }
}
