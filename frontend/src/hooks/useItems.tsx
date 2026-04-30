import {
  publicItemsList,
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
      },
    ],
    queryFn: async () => {
      const response = await publicItemsList({
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
  });
};
