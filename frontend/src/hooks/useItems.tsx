import {
  publicItemsList,
  type PublicItemsListData,
  type StatusB0aEnum,
  type ConditionEnum,
  type SalesTypeEnum,
} from '@/services/django';
import { useQuery } from '@tanstack/react-query';
import { type ItemCategory } from './types';

export const useItems = ({
  category,
  search,
  page,
  status,
  minPrice,
  maxPrice,
  salesTypes,
  conditions,
  ordering,
  owner,
  collection,
}: {
  category?: ItemCategory;
  search?: string;
  page?: number;
  status?: StatusB0aEnum | StatusB0aEnum[];
  minPrice?: number;
  maxPrice?: number;
  salesTypes?: SalesTypeEnum[];
  conditions?: ConditionEnum[];
  ordering?: string;
  /** Restrict to items owned by this user id. */
  owner?: string;
  /** Restrict to items contained in this collection id. */
  collection?: string;
} = {}) => {
  const normalizedStatus =
    status === undefined ? undefined : Array.isArray(status) ? status : [status];
  const statusKey = normalizedStatus?.join(',');
  // sort the array so it can be better used as a key
  const conditionsSorted = conditions && [...conditions].sort();
  const salesTypesSorted = salesTypes && [...salesTypes].sort();

  return useQuery({
    queryKey: [
      'items',
      {
        category,
        search,
        page,
        status: statusKey,
        minPrice,
        maxPrice,
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
          sales_type: salesTypesSorted,
          conditions: conditionsSorted,
          ordering,
          user: owner,
          collection,
        } as NonNullable<PublicItemsListData['query']> & { collection?: string },
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
  });
};
