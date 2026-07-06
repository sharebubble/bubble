import { federatedItemsRetrieve } from '@/services/django';
import { useQuery } from '@tanstack/react-query';

export interface FederatedItem {
  id: string;
  name: string;
  description: string;
  category: string;
  sales_type: string;
  condition: string;
  status: string;
  price: string | null;
  price_currency: string;
  /** 'local' for items on this instance, 'remote' for mirrored items */
  source: 'local' | 'remote';
  /** Domain of the remote instance (null for local items) */
  instance: string | null;
  /** ActivityPub ID of the item (null for local items without federation) */
  ap_id: string | null;
  first_image_url: string | null;
  /** Rental period unit: 'h' (hourly), 'd' (daily), 'w' (weekly); null when unknown (defaults to hourly) */
  rental_period: 'h' | 'd' | 'w' | null;
}

export interface FederatedItemsResult {
  items: FederatedItem[];
  pagination: {
    count: number;
    next: string | null;
    previous: string | null;
  };
}

export const useFederatedItems = ({
  search,
  scope,
  category,
  salesType,
  limit,
  offset,
}: {
  search?: string;
  scope?: 'local' | 'federated' | 'all';
  category?: string;
  salesType?: string;
  limit?: number;
  offset?: number;
} = {}) => {
  return useQuery<FederatedItemsResult>({
    queryKey: ['federated-items', { search, scope, category, salesType, limit, offset }],
    queryFn: async () => {
      const response = await federatedItemsRetrieve({
        query: {
          search,
          scope,
          category,
          sales_type: salesType,
          limit,
          offset,
        } as never,
      });
      const data = response.data as {
        results?: FederatedItem[];
        count?: number;
        next?: string | null;
        previous?: string | null;
      };
      return {
        items: data.results ?? [],
        pagination: {
          count: data.count ?? 0,
          next: data.next ?? null,
          previous: data.previous ?? null,
        },
      };
    },
  });
};
