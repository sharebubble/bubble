/**
 * Social (SSO) sign-in forwarding, plus the guards that keep it from looping.
 *
 * When the deployment has exactly one social provider and no password login,
 * the login screen forwards to that provider automatically (see `pages/Auth`).
 * A full page navigation leaves the provider, comes back through the allauth
 * callback and reloads the app — so any React state guarding the forward is
 * gone by the time the browser is back. If that round trip does not end in an
 * authenticated session, the freshly mounted login screen forwards again, and
 * the browser bounces between app and provider indefinitely: the "flickering"
 * users report.
 *
 * A round trip can fail to authenticate for reasons the app cannot fix and the
 * user cannot see:
 *
 *   - allauth reports an error by redirecting to the callback URL with
 *     `?error=<code>&error_process=login` (signup closed, an email address that
 *     already belongs to another account, an expired or missing OAuth state —
 *     the state lives in the Django session for 10 minutes, so a slow login at
 *     the provider or a browser that dropped the session cookie ends here).
 *   - The login can also come back *without* an error and still be
 *     unauthenticated: allauth parks it in a pending flow (a social signup that
 *     needs a form, e.g. when the provider sends no email address, or a pending
 *     email verification). The session endpoint then answers 401 with those
 *     flows listed.
 *   - The session or config request can simply fail (offline, a 5xx, a proxy
 *     hiccup), which the app cannot tell apart from "signed out" without
 *     looking at the error.
 *
 * Two independent markers therefore record that a forward has been attempted:
 *
 *   1. A `sso` query parameter on the callback URL. It survives storage being
 *      unavailable and is the most reliable signal, but allauth drops it when
 *      it cannot recover the OAuth state (it then falls back to the configured
 *      frontend error URL, losing the callback URL entirely).
 *   2. A short-lived `sessionStorage` timestamp, which covers exactly that case.
 *
 * Either marker suppresses the automatic forward, so the user gets the login
 * screen with a real message and a button instead of an endless bounce.
 */

import { authAPI } from '@/services/custom/auth';
import { client } from '@/services/django/client.gen';

/** Set on the callback URL so a returning browser is recognisable. */
const RETURN_PARAM = 'sso';
/** Appended by allauth when a social login fails; see `headless/socialaccount`. */
const ERROR_PARAM = 'error';
const ERROR_PROCESS_PARAM = 'error_process';

const ATTEMPT_KEY = 'bubble-sso-attempt';
/**
 * How long a recorded attempt blocks the next automatic forward. Long enough to
 * cover a completed round trip (a redirect chain plus the reload), short enough
 * that a user who fixes the cause — signs in at the provider, gets an account —
 * is forwarded automatically again rather than being stuck with the button.
 */
const ATTEMPT_TTL_MS = 60_000;

/**
 * Why the automatic forward is currently suppressed.
 *
 * - `attempt`: a forward was started and has not produced a session (yet).
 * - `signout`: the user deliberately signed out. The provider's own session
 *   normally outlives Bubble's, so forwarding would sign them straight back in
 *   — "Sign out" would do nothing but flash the screen. This one has no TTL:
 *   it holds for the rest of the tab's session, while a fresh tab (or a
 *   relaunched installed app) signs in automatically as before.
 */
export type SsoSuppression = 'attempt' | 'signout';

interface StoredSuppression {
  reason: SsoSuppression;
  at: number;
}

export interface SsoReturn {
  /** The browser came back from a provider round trip that left it signed out. */
  returned: boolean;
  /** allauth's error code, when it reported one (e.g. "signup_closed"). */
  error: string | null;
}

/**
 * Read the markers allauth put on the URL and strip them again.
 *
 * Stripping matters beyond tidiness: the root route treats any query string as
 * "this is a catalogue deep link" and redirects to /browse, so leftovers would
 * send a successfully signed-in user to the wrong start page. Read once at
 * module load, before the router ever looks at the location.
 */
function readAndStripReturnParams(): SsoReturn {
  if (typeof window === 'undefined') return { returned: false, error: null };

  const url = new URL(window.location.href);
  const returned = url.searchParams.has(RETURN_PARAM);
  const error = url.searchParams.get(ERROR_PARAM);
  // An `error` that belongs to another process (e.g. connecting an account) is
  // not this screen's business, but it still marks a completed round trip.
  const isLoginError = error !== null && url.searchParams.get(ERROR_PROCESS_PARAM) !== 'connect';

  if (!returned && error === null) return { returned: false, error: null };

  for (const param of [RETURN_PARAM, ERROR_PARAM, ERROR_PROCESS_PARAM]) {
    url.searchParams.delete(param);
  }
  window.history.replaceState(window.history.state, '', url.toString());

  return { returned: true, error: isLoginError ? error : null };
}

const ssoReturn = readAndStripReturnParams();

/** What the current page load knows about a just-finished provider round trip. */
export function getSsoReturn(): SsoReturn {
  return ssoReturn;
}

// Storage can throw outright (Safari with site data blocked), so every access is
// guarded and falls back to a value that at least survives within the page.
let fallback: StoredSuppression | null = null;

function write(reason: SsoSuppression): void {
  const stored: StoredSuppression = { reason, at: Date.now() };
  fallback = stored;
  try {
    window.sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(stored));
  } catch {
    // Ignore: the in-memory copy and the URL marker still guard the forward.
  }
}

function read(): StoredSuppression | null {
  try {
    const raw = window.sessionStorage.getItem(ATTEMPT_KEY);
    if (raw) return JSON.parse(raw) as StoredSuppression;
  } catch {
    // Unreadable or unparsable: fall through to the in-memory copy.
  }
  return fallback;
}

/** Recorded just before leaving for the provider. */
export function recordSsoAttempt(): void {
  write('attempt');
}

/** Recorded on sign-out, so signing out is not undone by an instant forward. */
export function suppressAutoSso(): void {
  write('signout');
}

/** Called once a session exists, so the next visit forwards without friction. */
export function clearSsoAttempt(): void {
  fallback = null;
  try {
    window.sessionStorage.removeItem(ATTEMPT_KEY);
  } catch {
    // Ignore.
  }
}

export function getSsoSuppression(): SsoSuppression | null {
  const stored = read();
  if (!stored) return null;
  if (stored.reason === 'signout') return 'signout';
  return Date.now() - stored.at < ATTEMPT_TTL_MS ? 'attempt' : null;
}

/**
 * Submit a hidden form that triggers an allauth social provider login redirect.
 *
 * The endpoint is CSRF protected, so the token has to be there *before* the
 * form is submitted — posting an empty one lands the user on a 403 page instead
 * of at the provider. The token normally arrives with the session request the
 * app makes at startup; this awaits it for the cases where that request never
 * completed (offline, a cold backend, cookies just cleared).
 */
export async function redirectToSocialProvider(providerId: string): Promise<void> {
  const csrfToken = await authAPI.fetchCSRFToken();
  if (!csrfToken) {
    throw new Error('Could not obtain a CSRF token for the provider redirect');
  }

  // Recorded before leaving: the app does not run again until it is back.
  recordSsoAttempt();

  const form = document.createElement('form');
  form.style.display = 'none';
  form.method = 'POST';
  form.action = `${client.getConfig().baseUrl}/api/_allauth/browser/v1/auth/provider/redirect`;
  const data = {
    provider: providerId,
    callback_url: `${window.location.origin}/?${RETURN_PARAM}=1`,
    csrfmiddlewaretoken: csrfToken,
    process: 'login',
  };

  Object.entries(data).forEach(([k, v]) => {
    const input = document.createElement('input');
    input.name = k;
    input.value = v;
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
}
