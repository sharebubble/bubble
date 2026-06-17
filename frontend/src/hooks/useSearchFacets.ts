import { fetchSearchFacets, type SearchFacetParams } from '@/services/custom/search';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

/**
 * Cross-filtered search facets for the header search popup.
 *
 * `params` is the currently active selection; each facet in the response is
 * computed over the visible items narrowed by every *other* selection, so the
 * options and counts update as filters are picked. Previous data is kept while
 * refetching so the lists don't flash empty when a filter changes.
 */
export const useSearchFacets = (
  params: SearchFacetParams,
  { enabled = true }: { enabled?: boolean } = {},
) =>
  useQuery({
    queryKey: ['public-items', 'facets', params],
    queryFn: () => fetchSearchFacets(params),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });
