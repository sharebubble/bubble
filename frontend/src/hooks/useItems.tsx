import {
  publicItemsList,
  type PublicItemsListData,
  type Status7D3Enum,
  type ConditionEnum,
  type SalesTypeEnum,
} from '@/services/django';
import { useQuery } from '@tanstack/react-query';
import { type ItemCategory } from './types';

export type UseItemsParams = {
  category?: ItemCategory;
  search?: string;
  page?: number;
  status?: Status7D3Enum | Status7D3Enum[];
  minPrice?: number;
  maxPrice?: number;
  /** Restrict to free items (null or zero price). */
  free?: boolean;
  salesTypes?: SalesTypeEnum[];
  conditions?: ConditionEnum[];
  ordering?: string;
  /** Restrict to items owned by this user id. */
  owner?: string;
  /** Restrict to items contained in this collection id. */
  collection?: string;
};

/**
 * Query key + fetcher for a page of published items, shared between
 * {@link useItems} (a single page) and callers that need several pages at
 * once via `useQueries` (e.g. the start page's "load more").
 */
export const itemsQueryOptions = ({
  category,
  search,
  page,
  status,
  minPrice,
  maxPrice,
  free,
  salesTypes,
  conditions,
  ordering,
  owner,
  collection,
}: UseItemsParams = {}) => {
  const normalizedStatus =
    status === undefined ? undefined : Array.isArray(status) ? status : [status];
  const statusKey = normalizedStatus?.join(',');
  // sort the array so it can be better used as a key
  const conditionsSorted = conditions && [...conditions].sort();
  const salesTypesSorted = salesTypes && [...salesTypes].sort();

  return {
    queryKey: [
      'items',
      {
        category,
        search,
        page,
        status: statusKey,
        minPrice,
        maxPrice,
        free,
        salesTypes: salesTypesSorted,
        conditions: conditionsSorted,
        ordering,
        owner,
        collection,
      },
    ],
    queryFn: async () => {
      const response = await publicItemsList({
        // `collection` is a valid backend filter that is not yet part of the
        // generated query type, so the object is widened before being passed.
        query: {
          category,
          page: page,
          search: search,
          status: normalizedStatus,
          min_price: minPrice,
          max_price: maxPrice,
          free,
          sales_type: salesTypesSorted,
          conditions: conditionsSorted,
          ordering,
          user: owner,
          collection,
        } as NonNullable<PublicItemsListData['query']> & {
          collection?: string;
          free?: boolean;
        },
      });
      return {
        items: response.data.results || [],
        pagination: {
          count: response.data.count,
          next: response.data.next ?? null,
          previous: response.data.previous ?? null,
        },
      };
    },
  };
};

export const useItems = (params: UseItemsParams = {}) => {
  return useQuery(itemsQueryOptions(params));
};
