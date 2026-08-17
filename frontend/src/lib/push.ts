/**
 * Browser-side plumbing for Web Push.
 *
 * Kept out of React so sign-out can revoke a subscription without a component
 * being mounted. The service worker's `push` handler (src/sw/service-worker.js)
 * is the other half; the backend owns the VAPID keys and decides who gets what
 * (bubble/notifications).
 */

import {
  pushSubscriptionsSubscribeCreate,
  pushSubscriptionsUnsubscribeCreate,
} from '@/services/django';

/** Feature detection: Safari on iOS only qualifies once installed to the home screen. */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Decode the VAPID public key into the `BufferSource` `subscribe()` wants.
 *
 * The key travels as unpadded base64url (see bubble/notifications/webpush.py);
 * `atob` needs standard base64 with padding.
 */
function decodeVapidKey(base64UrlKey: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64UrlKey.length % 4)) % 4);
  const base64 = (base64UrlKey + padding).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  // Backed by an explicit ArrayBuffer: `applicationServerKey` takes a
  // BufferSource, which excludes the SharedArrayBuffer-backed view that
  // `Uint8Array.from` is typed to return.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Base64url-encode a raw subscription key, the shape the backend stores. */
function encodeSubscriptionKey(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  // `ready` never rejects but can hang forever if no worker is registered — which
  // is the case in dev, where registration is deliberately skipped.
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ?? null;
}

/** The subscription this browser currently holds, if any. */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  const registration = await getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/** True when *subscription* was created with a different application server key. */
function usesStaleKey(subscription: PushSubscription, vapidPublicKey: string): boolean {
  const current = subscription.options?.applicationServerKey;
  if (!current) return true;
  return encodeSubscriptionKey(current as ArrayBuffer) !== vapidPublicKey;
}

/**
 * Ask for permission, subscribe this browser and register it with the backend.
 *
 * Returns the resulting permission state so callers can tell "user said no" from
 * "not supported here" without inspecting Notification.permission themselves.
 */
export async function enablePush(
  vapidPublicKey: string,
): Promise<{ ok: boolean; permission: NotificationPermission | 'unsupported' }> {
  if (!isPushSupported()) return { ok: false, permission: 'unsupported' };
  if (!vapidPublicKey) return { ok: false, permission: Notification.permission };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, permission };

  const registration = await getRegistration();
  if (!registration) return { ok: false, permission };

  let subscription = await registration.pushManager.getSubscription();

  // A subscription made against a previous VAPID keypair is silently useless:
  // the push service rejects anything signed with the new key. Rotating keys is
  // rare but the failure is invisible, so always re-subscribe rather than trust
  // what is already there.
  if (subscription && usesStaleKey(subscription, vapidPublicKey)) {
    await subscription.unsubscribe().catch(() => {});
    subscription = null;
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      // Required by Chromium: every push must result in a visible notification.
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(vapidPublicKey),
    });
  }

  await pushSubscriptionsSubscribeCreate({
    body: {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: encodeSubscriptionKey(subscription.getKey('p256dh')),
        auth: encodeSubscriptionKey(subscription.getKey('auth')),
      },
      user_agent: navigator.userAgent.slice(0, 300),
    },
  });

  return { ok: true, permission };
}

/** Unsubscribe this browser and tell the backend to forget it. */
export async function disablePush(): Promise<void> {
  const subscription = await getExistingSubscription();
  if (!subscription) return;

  const { endpoint } = subscription;
  await subscription.unsubscribe().catch(() => {});
  await pushSubscriptionsUnsubscribeCreate({ body: { endpoint } });
}

/**
 * Drop this browser's subscription as part of signing out.
 *
 * Must run *before* the session is torn down, since the unsubscribe call is
 * authenticated. Failures are swallowed: revoking locally already invalidates the
 * endpoint at the push service, so anything still sent to it comes back 410 and
 * the backend prunes the row.
 *
 * Without this, the next person to sign in on a shared browser would inherit a
 * subscription that is still registered to the previous account.
 */
export async function revokePushOnSignOut(): Promise<void> {
  try {
    await disablePush();
  } catch {
    // Best effort — never block sign-out.
  }
}
