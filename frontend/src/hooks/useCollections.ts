import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import {
  collectionsCreate,
  collectionsDestroy,
  collectionsPartialUpdate,
  collectionsRetrieve,
  collectionsAddItemCreate,
  collectionsRemoveItemCreate,
  collectionsMyCollectionsList,
  collectionsManagePermissionsCreate,
  collectionsHistoryList,
  collectionsForItemList,
  collectionsPermissionsList,
  collectionsList,
  type CollectionList,
  type CollectionEvent,
  type CollectionGrant,
} from '@/services/django';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/** Returns all collections owned by the current user. */
export const useMyCollections = () => {
  return useQuery({
    queryKey: ['collections', 'mine'],
    queryFn: async () => {
      const response = await collectionsMyCollectionsList();
      // SDK incorrectly types this as a single Collection — it's actually an array
      return (response.data as unknown as CollectionList[]) ?? [];
    },
  });
};

/** Returns all collections the current user can view (own + shared with them). */
export const useAllCollections = ({ enabled = true }: { enabled?: boolean } = {}) => {
  return useQuery({
    queryKey: ['collections', 'all'],
    queryFn: async () => {
      const response = await collectionsList();
      // The list endpoint returns a paginated response; extract results array
      const data = response.data as unknown as { results?: CollectionList[] } | CollectionList[];
      if (Array.isArray(data)) return data;
      return data?.results ?? [];
    },
    enabled,
  });
};

/** Returns a single collection with full item list. */
export const useCollection = (id?: string) => {
  return useQuery({
    queryKey: ['collections', id],
    queryFn: async () => {
      if (!id) throw new Error('Collection id is required');
      const response = await collectionsRetrieve({ path: { id } });
      return response.data;
    },
    enabled: !!id,
  });
};

/** Create a new collection. */
export const useCreateCollection = () => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ name, description }: { name: string; description?: string }) => {
      const response = await collectionsCreate({ body: { name, description } });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections', 'mine'] });
      queryClient.invalidateQueries({ queryKey: ['collections', 'all'] });
      toast({ title: t('collections.createCollection') });
    },
    onError: (error: any) => {
      console.error('Error creating collection:', error);
      toast({
        title: t('common.error'),
        description: t('collections.createCollection'),
        variant: 'destructive',
      });
    },
  });
};

/** Update an existing collection's name/description. */
export const useUpdateCollection = () => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      name,
      description,
    }: {
      id: string;
      name: string;
      description?: string;
    }) => {
      const response = await collectionsPartialUpdate({
        path: { id },
        body: { name, description },
      });
      return response.data;
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['collections', 'mine'] });
      queryClient.invalidateQueries({ queryKey: ['collections', id] });
      toast({ title: t('collections.saveChanges') });
    },
    onError: (error: any) => {
      console.error('Error updating collection:', error);
      toast({
        title: t('common.error'),
        description: t('collections.saveChanges'),
        variant: 'destructive',
      });
    },
  });
};

/** Delete a collection. */
export const useDeleteCollection = () => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await collectionsDestroy({ path: { id } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections', 'mine'] });
      queryClient.invalidateQueries({ queryKey: ['collections', 'all'] });
      toast({ title: t('collections.deleteCollection') });
    },
    onError: (error: any) => {
      console.error('Error deleting collection:', error);
      toast({
        title: t('common.error'),
        description: t('collections.deleteCollection'),
        variant: 'destructive',
      });
    },
  });
};

/** Add an item to a collection. */
export const useAddItemToCollection = () => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      collectionId,
      itemId,
      note,
      ordering,
    }: {
      collectionId: string;
      itemId: string;
      note?: string;
      ordering?: number;
    }) => {
      const response = await collectionsAddItemCreate({
        path: { id: collectionId },
        body: { item_id: itemId, note, ordering } as any,
      });
      return response.data;
    },
    onSuccess: (_data, { collectionId, itemId }) => {
      queryClient.invalidateQueries({ queryKey: ['collections', collectionId] });
      queryClient.invalidateQueries({ queryKey: ['collections', 'mine'] });
      queryClient.invalidateQueries({ queryKey: ['collections', 'for-item', itemId] });
      toast({ title: t('collections.addedToCollection') });
    },
    onError: (error: any) => {
      console.error('Error adding item to collection:', error);
      toast({
        title: t('common.error'),
        description: t('collections.addToCollection'),
        variant: 'destructive',
      });
    },
  });
};

/** Remove an item from a collection. */
export const useRemoveItemFromCollection = () => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ collectionId, itemId }: { collectionId: string; itemId: string }) => {
      await collectionsRemoveItemCreate({
        path: { id: collectionId, item_id: itemId },
        body: {} as any,
      });
    },
    onSuccess: (_data, { collectionId, itemId }) => {
      queryClient.invalidateQueries({ queryKey: ['collections', collectionId] });
      queryClient.invalidateQueries({ queryKey: ['collections', 'mine'] });
      queryClient.invalidateQueries({ queryKey: ['collections', 'for-item', itemId] });
      toast({ title: t('collections.removedFromCollection') });
    },
    onError: (error: any) => {
      console.error('Error removing item from collection:', error);
      toast({
        title: t('common.error'),
        description: t('collections.removeFromCollection'),
        variant: 'destructive',
      });
    },
  });
};

/** Grant or revoke a permission on a collection for a user. */
export const useManageCollectionPermission = () => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      collectionId,
      userId,
      groupId,
      role,
      action,
    }: {
      collectionId: string;
      userId?: string;
      groupId?: string;
      role: 'view' | 'edit' | 'owner';
      action: 'grant' | 'revoke';
    }) => {
      const body = groupId
        ? { group_id: groupId, role, action }
        : { user_id: userId, role, action };
      const response = await collectionsManagePermissionsCreate({
        path: { id: collectionId },
        body: body as any,
      });
      return response.data;
    },
    onSuccess: (_data, { collectionId }) => {
      queryClient.invalidateQueries({ queryKey: ['collections', collectionId] });
      queryClient.invalidateQueries({ queryKey: ['collections', collectionId, 'permissions'] });
      toast({ title: t('collections.permissions') });
    },
    onError: (error: any) => {
      console.error('Error managing collection permission:', error);
      toast({
        title: t('common.error'),
        description: t('collections.permissions'),
        variant: 'destructive',
      });
    },
  });
};

/** Returns all collections visible to the current user that contain the given item. */
export const useItemCollections = (itemId: string | undefined) => {
  return useQuery({
    queryKey: ['collections', 'for-item', itemId],
    enabled: !!itemId,
    queryFn: async () => {
      const response = await collectionsForItemList({
        path: { item_id: itemId! },
      });
      // API returns a plain array; the SDK types it as paginated — cast accordingly
      return (response.data as unknown as CollectionList[]) ?? [];
    },
  });
};
export const useCollectionHistory = (collectionId: string | undefined) => {
  return useQuery({
    queryKey: ['collections', collectionId, 'history'],
    enabled: !!collectionId,
    queryFn: async () => {
      const response = await collectionsHistoryList({
        path: { id: collectionId! },
      });
      // API returns a plain array; the SDK types it as paginated — cast accordingly
      return (response.data as unknown as CollectionEvent[]) ?? [];
    },
  });
};

/** Returns all current permission grants for a collection (owner only). */
export const useCollectionPermissions = (collectionId: string | undefined) => {
  return useQuery({
    queryKey: ['collections', collectionId, 'permissions'],
    enabled: !!collectionId,
    queryFn: async () => {
      const response = await collectionsPermissionsList({
        path: { id: collectionId! },
      });
      // API returns a plain array; the SDK types it as paginated — cast accordingly
      return (response.data as unknown as CollectionGrant[]) ?? [];
    },
  });
};
