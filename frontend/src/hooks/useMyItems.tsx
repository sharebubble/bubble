import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import {
  itemsDestroy,
  itemsList,
  itemsPartialUpdate,
  Status402Enum,
  type PaginatedItemListList,
} from '@/services/django';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const useMyItems = (page?: number) => {
  const { user } = useAuth();

  return useQuery<PaginatedItemListList>({
    queryKey: ['my-items', user?.id, page],
    queryFn: async () => {
      if (!user) throw new Error('User not authenticated');
      const response = await itemsList({
        query: {
          user: user.id,
          page: page,
        },
      });
      return response.data;
    },
    enabled: !!user,
  });
};

export const useUpdateItemStatus = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useLanguage();

  return useMutation({
    mutationFn: async ({ itemId, status }: { itemId: string; status: Status402Enum }) => {
      const response = await itemsPartialUpdate({
        path: { id: itemId },
        body: { status },
      });

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-items', user?.id] });
      toast({
        title: t('myItems.statusUpdated'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('common.error'),
        description: JSON.stringify(error),
        variant: 'destructive',
      });
    },
  });
};

export const useDeleteItem = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (itemId: string) => {
      if (!user) throw new Error('User not authenticated');
      const response = await itemsDestroy({
        path: { id: itemId },
      });

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-items', user?.id] });
      toast({
        title: 'Item Deleted',
        description: 'The item has been successfully deleted.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error Deleting Item',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
