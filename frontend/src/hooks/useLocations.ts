import { client } from '@/services/django/client.gen';
import { useQuery } from '@tanstack/react-query';

/**
 * A physical placement an item can be assigned to (e.g. a library shelf or a
 * shared workspace area). Managed by curators in the Django admin and exposed
 * read-only via `/api/locations/`.
 *
 * Note: this is distinct from the per-user geographic `UserLocation`
 * (address / map coordinates).
 */
export type Location = {
  id: string;
  name: string;
  section: string;
  item_category: string;
  item_category_display: string;
  description: string;
  sort_order: number;
};

/**
 * Fetch the locations available for a given item category. The backend returns
 * locations scoped to that category plus the category-agnostic ones. Pass an
 * empty/undefined category to skip the request.
 */
export const useLocations = (itemCategory?: string) => {
  return useQuery<Location[]>({
    queryKey: ['locations', itemCategory || ''],
    enabled: !!itemCategory,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (itemCategory) {
        params.set('item_category', itemCategory);
      }
      const response = await fetch(
        `${client.getConfig().baseUrl}/api/locations/?${params.toString()}`,
        { credentials: 'include' },
      );
      if (!response.ok) {
        throw new Error(`Failed to load locations: ${response.status}`);
      }
      const data = await response.json();
      // DRF may paginate; support both list and {results: [...]} shapes.
      return Array.isArray(data) ? data : (data.results ?? []);
    },
  });
};
