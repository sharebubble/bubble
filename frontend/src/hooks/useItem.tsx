import { publicItemsRetrieve } from '@/services/django';
import { useQuery } from '@tanstack/react-query';

export class ItemNotFoundError extends Error {
  constructor() {
    super('Item not found');
    this.name = 'ItemNotFoundError';
  }
}

export const useItem = (itemUuid?: string) => {
  return useQuery({
    queryKey: ['item', itemUuid],
    queryFn: async () => {
      if (!itemUuid) throw new Error('Item UUID is required');
      const response = await publicItemsRetrieve({
        path: { id: itemUuid },
      });
      const status = response.response?.status;
      // 400 covers malformed UUIDs, which can never resolve to an item either.
      if (status === 404 || status === 400) throw new ItemNotFoundError();
      if (response.data === undefined)
        throw new Error(`Failed to load item (${status ?? 'network'})`);
      return response.data;
    },
    enabled: !!itemUuid,
    // A missing item won't appear by retrying; show the 404 page right away.
    retry: (failureCount, error) => !(error instanceof ItemNotFoundError) && failureCount < 3,
  });
};
