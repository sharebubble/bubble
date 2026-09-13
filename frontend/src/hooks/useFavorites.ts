import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  favoritesCreate,
  favoritesDestroy,
  favoritesItemIdsRetrieve,
  favoritesList,
  type FavoriteItem,
} from '@/services/django';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const FAVORITES_KEY = ['favorites'] as const;
const FAVORITE_IDS_KEY = ['favorites', 'item-ids'] as const;

/** The current user's favorites, newest mark first. */
export const useFavorites = ({ enabled = true }: { enabled?: boolean } = {}) => {
  const { session } = useAuth();

  return useQuery({
    queryKey: FAVORITES_KEY,
    // Favorites are per user and the endpoint rejects anonymous callers, so
    // there is nothing to ask for until someone is signed in.
    enabled: enabled && !!session,
    queryFn: async () => {
      const response = await favoritesList();
      return (response.data.results ?? []) as FavoriteItem[];
    },
  });
};

/** The ids of every item the current user has marked — cheap membership checks. */
export const useFavoriteItemIds = () => {
  const { session } = useAuth();

  return useQuery({
    queryKey: FAVORITE_IDS_KEY,
    enabled: !!session,
    queryFn: async () => {
      const response = await favoritesItemIdsRetrieve();
      return new Set(response.data.item_ids ?? []);
    },
  });
};

/** Whether the given item is among the current user's favorites. */
export const useIsFavorite = (itemId?: string) => {
  const { data, isLoading } = useFavoriteItemIds();
  return { isFavorite: !!itemId && !!data?.has(itemId), isLoading };
};

/**
 * Mark or unmark an item, driven by the current state passed in.
 *
 * Both lists are invalidated on success so the start page row and the
 * favorites overview pick the change up without a reload.
 */
export const useToggleFavorite = () => {
  const queryClient = useQueryClient();
  const { t } = useLanguage();

  return useMutation({
    mutationFn: async ({ itemId, favorite }: { itemId: string; favorite: boolean }) => {
      if (favorite) {
        await favoritesCreate({ body: { item: itemId } });
      } else {
        await favoritesDestroy({ path: { item_id: itemId } });
      }
      return favorite;
    },
    onSuccess: added => {
      queryClient.invalidateQueries({ queryKey: FAVORITES_KEY });
      notifications.show({
        message: added ? t('favorites.added') : t('favorites.removed'),
        color: added ? 'green' : undefined,
      });
    },
    onError: (error: unknown) => {
      console.error('Error toggling favorite:', error);
      notifications.show({ message: t('favorites.error'), color: 'red' });
    },
  });
};
