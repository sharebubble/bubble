import { publicItemsRetrieve } from '@/services/django';
import { useQuery } from '@tanstack/react-query';

export const useItem = (itemUuid?: string) => {
  return useQuery({
    queryKey: ['item', itemUuid],
    queryFn: async () => {
      if (!itemUuid) throw new Error('Item UUID is required');
      const response = await publicItemsRetrieve({
        path: { id: itemUuid },
      });
      return response.data;
    },
    enabled: !!itemUuid,
  });
};
