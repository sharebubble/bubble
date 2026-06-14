import { fetchCategoryFacets, fetchItemOwners } from '@/services/custom/search';
import { useQuery } from '@tanstack/react-query';

/**
 * Owners of shared items, for the "owner" facet of the header search.
 *
 * Only meaningful for logged-in users, so callers should pass `enabled` to
 * avoid firing the request for anonymous visitors.
 */
export const useItemOwners = ({ enabled = true }: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: ['public-items', 'owners'],
    queryFn: fetchItemOwners,
    enabled,
    staleTime: 5 * 60 * 1000,
  });

/** Categories present among shared items, with item counts, for the search popup. */
export const useCategoryFacets = ({ enabled = true }: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: ['public-items', 'category-facets'],
    queryFn: fetchCategoryFacets,
    enabled,
    staleTime: 5 * 60 * 1000,
  });
