import { client } from '@/services/django/client.gen';
import { useQuery } from '@tanstack/react-query';

interface AppConfig {
  REQUIRE_LOGIN: boolean;
  DEFAULT_ITEM_VISIBILITY: string;
}

interface UseAppConfigResult {
  requireLogin: boolean;
  loading: boolean;
}

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

  return {
    // Default to true (require login) while loading or on error — safe fallback
    requireLogin: data ? data.REQUIRE_LOGIN : true,
    loading: isLoading,
  };
};
