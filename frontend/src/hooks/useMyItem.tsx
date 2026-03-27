import { itemsRetrieve } from '@/services/django';
import { useQuery } from '@tanstack/react-query';

export const useMyItem = (itemUuid?: string) => {
  return useQuery({
    queryKey: ['item', itemUuid],
    queryFn: async () => {
      if (!itemUuid) throw new Error('Item UUID is required');
      const response = await itemsRetrieve({
        path: { id: itemUuid },
      });
      return response.data;
    },
    enabled: !!itemUuid,
  });
};
