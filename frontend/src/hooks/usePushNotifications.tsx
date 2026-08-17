import { useAppConfig } from '@/hooks/useAppConfig';
import { useAuth } from '@/hooks/useAuth';
import {
  disablePush,
  enablePush,
  getExistingSubscription,
  getNotificationPermission,
  isPushSupported,
} from '@/lib/push';
import { pushSubscriptionsTestCreate } from '@/services/django';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

/** Why the push toggle cannot be offered, when it cannot. */
export type PushBlocker =
  /** No Push API here — notably iOS Safari until the app is installed. */
  | 'unsupported'
  /** The backend has no VAPID keys, so nothing could be sent. */
  | 'not-configured'
  /** The user (or a policy) denied notifications; only they can undo it. */
  | 'denied'
  | null;

/**
 * Push state for *this browser*.
 *
 * Two independent things have to be true before a user is notified: this browser
 * holds a subscription (what this hook manages), and their account has the
 * `webpush` event toggles on (NotificationPreference, managed separately). The
 * split is deliberate — the device grant is local and revocable per device, the
 * event choice belongs to the account.
 */
export function usePushNotifications() {
  const { user } = useAuth();
  const { vapidPublicKey, loading: configLoading } = useAppConfig();
  const queryClient = useQueryClient();
  const [permission, setPermission] = useState(getNotificationPermission);

  const supported = isPushSupported();
  const configured = Boolean(vapidPublicKey);

  const { data: subscribed, isLoading: subscriptionLoading } = useQuery({
    queryKey: ['push-subscription', user?.username],
    queryFn: async () => (await getExistingSubscription()) !== null,
    enabled: Boolean(user) && supported,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['push-subscription'] });
    // `webpush_available` on the preferences endpoint counts this user's devices.
    queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
  }, [queryClient]);

  const subscribe = useMutation({
    mutationFn: async () => {
      const result = await enablePush(vapidPublicKey);
      setPermission(result.permission);
      return result.ok;
    },
    onSuccess: invalidate,
  });

  const unsubscribe = useMutation({
    mutationFn: disablePush,
    onSuccess: invalidate,
  });

  const sendTest = useMutation({
    mutationFn: async () => {
      await pushSubscriptionsTestCreate();
    },
  });

  let blocker: PushBlocker = null;
  if (!supported) blocker = 'unsupported';
  else if (!configured) blocker = 'not-configured';
  else if (permission === 'denied') blocker = 'denied';

  return {
    /** Whether the push section should be shown at all. */
    available: supported && configured,
    blocker,
    subscribed: subscribed === true,
    loading: configLoading || subscriptionLoading,
    busy: subscribe.isPending || unsubscribe.isPending,
    testPending: sendTest.isPending,
    subscribe: subscribe.mutateAsync,
    unsubscribe: unsubscribe.mutateAsync,
    sendTest: sendTest.mutateAsync,
  };
}
