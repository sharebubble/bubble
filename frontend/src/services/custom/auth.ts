/**
 * Django API authentication integration
 *
 * This module provides a clean API for Django allauth authentication operations.
 * It handles CSRF token management, login/logout operations, and session management.
 *
 * Usage:
 * - authAPI.login(credentials) - Login with username/password
 * - authAPI.logout() - Logout current user
 * - authAPI.getSession() - Get current session data
 * - authAPI.fetchCSRFToken() - Get CSRF token for form submissions
 *
 * All functions handle CSRF tokens automatically and include proper error handling.
 */

import { client } from '../django/client.gen';
import { getCookie } from '@/lib/utils';

// Django API authentication integration

// Core types for Django allauth session management
export interface User {
  id: string;
  email: string;
  username: string;
  display: string;
  has_usable_password: boolean;
}

export interface AuthMethod {
  method: 'password' | 'socialaccount' | 'mfa';
  at: number;
  email?: string;
  username?: string;
  reauthenticated?: boolean;
  provider?: string;
  uid?: string;
  type?: 'recovery_codes' | 'totp';
}

export interface Session {
  user: User;
  methods: AuthMethod[];
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface LoginResponse {
  status: number;
  data: Session;
  meta: {
    is_authenticated: boolean;
  };
}

/** A step allauth is waiting on, e.g. `provider_signup` or `verify_email`. */
export interface AuthFlow {
  id: string;
  is_pending?: boolean;
}

export interface SessionResponse {
  meta: {
    is_authenticated: boolean;
  };
  /** Carries the user when authenticated, the open flows when not. */
  data: Session & { flows?: AuthFlow[] };
}

class AuthAPI {
  /**
   * @param acceptStatuses Error statuses whose JSON body is a valid answer
   *   rather than a failure. allauth replies 401 with the session state (and,
   *   during a half-finished login, the pending flows) — information the caller
   *   needs, and which must not be confused with the backend being unreachable.
   */
  private async request<T>(
    endpoint: string,
    options?: RequestInit,
    acceptStatuses: number[] = [],
  ): Promise<T> {
    const baseURL = client.getConfig().baseUrl;

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    const method = options?.method?.toUpperCase();
    if (method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const csrfToken = this.getCSRFToken();
      if (csrfToken) {
        headers['X-CSRFToken'] = csrfToken;
      }
    }

    const response = await fetch(`${baseURL}${endpoint}`, {
      credentials: 'include',
      headers,
      ...options,
    });

    if (!response.ok) {
      if (acceptStatuses.includes(response.status)) {
        return (await response.json().catch(() => undefined)) as T;
      }
      if (response.status === 401) {
        console.debug('[API] 401 Unauthorized – ignoring silently');
        return Promise.resolve(undefined as T);
      }
      const data = await response.json().catch(() => ({}));
      let errorMessage: string;
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        // allauth headless format: [{ message, code, param }]
        errorMessage = data.errors.map((e: { message: string }) => e.message).join(' ');
      } else if (data.errors && typeof data.errors === 'object') {
        // DRF format: { field: ["error"] }
        errorMessage = Object.values(data.errors).flat().join(', ');
      } else {
        errorMessage = `API Error: ${response.status} ${response.statusText}`;
      }
      throw new Error(errorMessage);
    }

    if (response.status === 204) {
      return Promise.resolve(undefined as T);
    }

    return response.json();
  }

  // Utility function to get CSRF token from cookies
  getCSRFToken(): string | null {
    return getCookie('csrftoken');
  }

  // Fetch CSRF token from Django session endpoint
  async fetchCSRFToken(): Promise<string | null> {
    try {
      let token = this.getCSRFToken();
      if (!token) {
        // Fetch CSRF token from Django by calling session endpoint
        await this.request(
          '/api/_allauth/browser/v1/auth/session',
          { method: 'GET', credentials: 'include' },
          // Anonymous is the normal case here — the cookie comes with the 401.
          [401, 410],
        );
        token = this.getCSRFToken();
      }
      return token;
    } catch (error) {
      console.error('Failed to fetch CSRF token:', error);
      return null;
    }
  }

  // Login with username and password
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    try {
      const response = await this.request<LoginResponse>('/api/_allauth/browser/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });

      return response;
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }

  /**
   * Get the current session.
   *
   * allauth answers 401 for an anonymous *and* for a half-finished session (a
   * social login parked in a pending signup or email verification), with the
   * flows in the body. Both are valid answers, so they are returned rather than
   * thrown; only a network failure or a server error rejects, which is what
   * lets the caller tell "signed out" apart from "backend did not answer".
   */
  async getSession(): Promise<SessionResponse | undefined> {
    return await this.request<SessionResponse | undefined>(
      '/api/_allauth/browser/v1/auth/session',
      undefined,
      [401, 410],
    );
  }

  // Logout current user
  async logout(): Promise<void> {
    await this.request<void>('/api/_allauth/browser/v1/auth/session', {
      method: 'DELETE',
    });
  }
}

// Export singleton instance
export const authAPI = new AuthAPI();

// Export individual methods for backward compatibility
export const { login, logout, getSession, getCSRFToken, fetchCSRFToken } = authAPI;
