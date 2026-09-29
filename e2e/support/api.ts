import type { APIRequest, APIRequestContext } from '@playwright/test';

import { roleStatePath } from './auth-state';
import { credentialsFor, env, type Role } from './config';

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

/** Booking lifecycle states — mirrors backend BookingStatus (IntegerChoices). */
export const BookingStatus = {
  PENDING: 1,
  CANCELLED: 2,
  CONFIRMED: 3,
  COMPLETED: 4,
  REJECTED: 5,
} as const;

export interface Item {
  id: string;
  name: string;
  status: number;
  sales_type: string;
}

export interface Booking {
  id: string;
  status: number;
  item: string;
  offer: string | null;
  counter_offer: string | null;
}

/** Minimal item-create payload; caller overrides fields as needed. */
export interface ItemInput {
  name: string;
  sales_type?: string;
  price?: string;
  price_currency?: string;
  status?: number;
  category?: string;
  description?: string;
  rental_period?: string;
  rental_self_service?: boolean;
  visibility?: number;
  /** Charge bookings of this item through the community ledger. */
  payment_enabled?: boolean;
}

export interface BookingInput {
  item: string;
  time_from: string;
  time_to: string;
  offer?: string;
  offer_currency?: string;
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
    const cookie = state.cookies.find(c => c.name === 'csrftoken');
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

  // --- Generic authenticated JSON requests (CSRF-aware) ------------------------

  private async send(
    method: 'post' | 'patch' | 'delete',
    path: string,
    data?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const csrf = await this.csrfToken();
    const res = await this.request[method](`${this.apiURL}${path}`, {
      headers: { 'X-CSRFToken': csrf, 'Content-Type': 'application/json' },
      data: data as object | undefined,
    });
    const text = await res.text();
    return { status: res.status(), body: text ? JSON.parse(text) : null };
  }

  private async expectOk(
    method: 'post' | 'patch',
    path: string,
    data: unknown,
    okStatuses: number[],
  ): Promise<Record<string, unknown>> {
    const { status, body } = await this.send(method, path, data);
    if (!okStatuses.includes(status)) {
      throw new Error(`${method.toUpperCase()} ${path} → ${status}: ${JSON.stringify(body)}`);
    }
    return body as Record<string, unknown>;
  }

  // --- Public JSON helpers (for domain modules such as support/ledger.ts) -------

  /** GET a JSON endpoint; throws on a non-2xx answer. */
  async getJson<T = unknown>(path: string, params?: Record<string, string>): Promise<T> {
    const res = await this.request.get(`${this.apiURL}${path}`, { params });
    if (!res.ok()) {
      throw new Error(`GET ${path} → ${res.status()}: ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  /** GET raw bytes (downloads such as CSV exports); throws on a non-2xx answer. */
  async getBytes(path: string, params?: Record<string, string>): Promise<Buffer> {
    const res = await this.request.get(`${this.apiURL}${path}`, { params });
    if (!res.ok()) {
      throw new Error(`GET ${path} → ${res.status()}: ${await res.text()}`);
    }
    return res.body();
  }

  /** POST JSON and expect one of `okStatuses`; returns the parsed body. */
  async postJson<T = Record<string, unknown>>(
    path: string,
    data: unknown = {},
    okStatuses: number[] = [200, 201],
  ): Promise<T> {
    return (await this.expectOk('post', path, data, okStatuses)) as T;
  }

  /** POST JSON without throwing; for asserting on refusals. */
  async tryPostJson(path: string, data: unknown = {}): Promise<{ status: number; body: unknown }> {
    return this.send('post', path, data);
  }

  // --- Domain helpers ----------------------------------------------------------

  /** Create an item; owner is the authenticated user. Sensible rental defaults. */
  async createItem(input: ItemInput): Promise<Item> {
    const payload = {
      sales_type: 'rent',
      price_currency: 'EUR',
      status: 2, // AVAILABLE → included in Item.objects.published()
      category: 'tools',
      visibility: 0, // PUBLIC
      description: 'E2E fixture item',
      ...input,
    };
    return (await this.expectOk('post', '/api/items/', payload, [201])) as unknown as Item;
  }

  async deleteItem(id: string): Promise<void> {
    await this.send('delete', `/api/items/${id}/`);
  }

  /** Create a booking (make an offer). Returns the booking (possibly auto-confirmed). */
  async createBooking(input: BookingInput): Promise<Booking> {
    const payload = { offer_currency: 'EUR', ...input };
    return (await this.expectOk('post', '/api/bookings/', payload, [201])) as unknown as Booking;
  }

  /** Attempt to create a booking, returning status + body without throwing. */
  async tryCreateBooking(input: BookingInput): Promise<{ status: number; body: unknown }> {
    return this.send('post', '/api/bookings/', { offer_currency: 'EUR', ...input });
  }

  async updateBooking(id: string, patch: Record<string, unknown>): Promise<Booking> {
    return (await this.expectOk(
      'patch',
      `/api/bookings/${id}/`,
      patch,
      [200],
    )) as unknown as Booking;
  }
}

/**
 * Build an API client authenticated as a pooled role, on its own request context.
 * Caller must `await handle.dispose()` when done.
 */
export async function authedApi(
  apiRequest: APIRequest,
  role: Role,
): Promise<{ api: ApiClient; dispose: () => Promise<void> }> {
  const context = await apiRequest.newContext({ baseURL: env.apiURL });
  const api = new ApiClient(context, env.apiURL);
  const { username, password } = credentialsFor(role);
  await api.login(username, password);
  return { api, dispose: () => context.dispose() };
}

/**
 * An API client for a pooled role that reuses the session the `setup` project
 * saved, instead of logging in again (allauth rate-limits repeated logins).
 * Caller must `await handle.dispose()` when done.
 */
export async function sessionApi(
  apiRequest: APIRequest,
  role: Role,
): Promise<{ api: ApiClient; dispose: () => Promise<void> }> {
  const context = await apiRequest.newContext({
    baseURL: env.apiURL,
    storageState: roleStatePath(role),
  });
  const api = new ApiClient(context, env.apiURL);
  return { api, dispose: () => context.dispose() };
}
