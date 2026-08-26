import { client } from '@/services/django/client.gen';
import { useQuery } from '@tanstack/react-query';

interface AppConfig {
  REQUIRE_LOGIN: boolean;
  DEFAULT_ITEM_VISIBILITY: string;
  NOTIFICATIONS_ENABLED?: Record<string, boolean>;
  /** VAPID application server key; empty when web push is not configured. */
  VAPID_PUBLIC_KEY?: string;
  /** Upper end of the slider offered after a free booking completes. */
  VOLUNTARY_PAYMENT_MAX?: number;
}

interface UseAppConfigResult {
  requireLogin: boolean;
  loading: boolean;
  /** Needed to subscribe a browser to push; empty means the feature is off. */
  vapidPublicKey: string;
  /**
   * Upper end of the voluntary-payment slider, in whole currency units. Only
   * bounds the suggestion UI — larger amounts can still be typed.
   */
  voluntaryPaymentMax: number;
}

/** Used when the backend has not been configured, or has not answered yet. */
const VOLUNTARY_PAYMENT_MAX_FALLBACK = 100;

export const useAppConfig = (): UseAppConfigResult => {
  const { data, isLoading } = useQuery<AppConfig>({
    queryKey: ['appConfig'],
    queryFn: async () => {
      const baseUrl = client.getConfig().baseUrl;
      const res = await fetch(`${baseUrl}/api/config/`, { credentials: 'include' });
      if (!res.ok) {
        throw new Error(`Failed to fetch app config: ${res.status}`);
      }
      return res.json();
    },
    // Config rarely changes — cache for 5 minutes, don't refetch on window focus
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const configuredMax = data?.VOLUNTARY_PAYMENT_MAX;

  return {
    // Default to true (require login) while loading or on error — safe fallback
    requireLogin: data ? data.REQUIRE_LOGIN : true,
    loading: isLoading,
    vapidPublicKey: data?.VAPID_PUBLIC_KEY ?? '',
    // A max of zero (or a negative one) would leave the slider unusable, so
    // fall back rather than pass it through.
    voluntaryPaymentMax:
      typeof configuredMax === 'number' && configuredMax > 0
        ? configuredMax
        : VOLUNTARY_PAYMENT_MAX_FALLBACK,
  };
};
