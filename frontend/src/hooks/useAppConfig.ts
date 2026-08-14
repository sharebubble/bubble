import { client } from '@/services/django/client.gen';
import { useQuery } from '@tanstack/react-query';

interface AppConfig {
  REQUIRE_LOGIN: boolean;
  DEFAULT_ITEM_VISIBILITY: string;
  NOTIFICATIONS_ENABLED?: Record<string, boolean>;
  /** VAPID application server key; empty when web push is not configured. */
  VAPID_PUBLIC_KEY?: string;
  COIN_NAME?: string;
  COIN_SHORT_NAME?: string;
  COIN_SLIDER_MAX?: number;
}

interface UseAppConfigResult {
  requireLogin: boolean;
  loading: boolean;
  /** Needed to subscribe a browser to push; empty means the feature is off. */
  vapidPublicKey: string;
}

/** Name and scale of the community currency, as configured on the backend. */
export interface CoinConfig {
  /** Full name, e.g. "Treibhaus Coins". */
  name: string;
  /** Short name shown next to amounts, e.g. "THC". */
  shortName: string;
  /** Upper end of the coin slider. */
  sliderMax: number;
}

const COIN_FALLBACK: CoinConfig = {
  name: 'Treibhaus Coins',
  shortName: 'THC',
  sliderMax: 100,
};

const fetchAppConfig = async (): Promise<AppConfig> => {
  const baseUrl = client.getConfig().baseUrl;
  const res = await fetch(`${baseUrl}/api/config/`, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`Failed to fetch app config: ${res.status}`);
  }
  return res.json();
};

const APP_CONFIG_QUERY = {
  queryKey: ['appConfig'],
  queryFn: fetchAppConfig,
  // Config rarely changes — cache for 5 minutes, don't refetch on window focus
  staleTime: 5 * 60 * 1000,
  refetchOnWindowFocus: false,
  retry: false,
} as const;

export const useAppConfig = (): UseAppConfigResult => {
  const { data, isLoading } = useQuery<AppConfig>(APP_CONFIG_QUERY);

  return {
    // Default to true (require login) while loading or on error — safe fallback
    requireLogin: data ? data.REQUIRE_LOGIN : true,
    loading: isLoading,
    vapidPublicKey: data?.VAPID_PUBLIC_KEY ?? '',
  };
};

/**
 * The community currency users can value free transactions in. Falls back to
 * the backend's own defaults while the config is loading.
 */
export const useCoinConfig = (): CoinConfig => {
  const { data } = useQuery<AppConfig>(APP_CONFIG_QUERY);

  return {
    name: data?.COIN_NAME || COIN_FALLBACK.name,
    shortName: data?.COIN_SHORT_NAME || COIN_FALLBACK.shortName,
    sliderMax: data?.COIN_SLIDER_MAX || COIN_FALLBACK.sliderMax,
  };
};
