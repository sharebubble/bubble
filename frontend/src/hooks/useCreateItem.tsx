import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import {
  itemsCreate,
  itemsPartialUpdate,
  PatchedItemWritable,
  type Item,
  type ItemWritable,
} from '@/services/django';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export const useCreateItem = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useLanguage();

  return useMutation<Item, Error, ItemWritable>({
    mutationFn: async (data: ItemWritable) => {
      if (!user) throw new Error('User not authenticated');
      const response = await itemsCreate({ body: data });
      return response.data;
    },
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: ['my-items', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      return data;
    },
    onError: (error: Error) => {
      toast({
        title: t('editItem.updateErrorTitle'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useUpdateItem = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useLanguage();

  return useMutation<Item, Error, { itemUuid: string; data: PatchedItemWritable }>({
    mutationFn: async ({ itemUuid, data }: { itemUuid: string; data: PatchedItemWritable }) => {
      if (!user) throw new Error('User not authenticated');
      const response = await itemsPartialUpdate({
        path: { id: itemUuid },
        body: data,
      });
      return response.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['my-items', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['item', variables.itemUuid] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      toast({
        title: t('editItem.updateSuccessTitle'),
        description: t('editItem.updateSuccessDescription'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('editItem.updateErrorTitle'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
