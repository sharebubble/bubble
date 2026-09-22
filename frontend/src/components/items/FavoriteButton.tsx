import { useLanguage } from '@/contexts/LanguageContext';
import { useIsFavorite, useToggleFavorite } from '@/hooks/useFavorites';
import { ActionIcon, Tooltip } from '@mantine/core';
import { Heart } from 'lucide-react';

interface FavoriteButtonProps {
  /** Item the heart belongs to. */
  itemId: string;
}

/**
 * Heart toggle that marks an item as one of the viewer's favorites.
 *
 * Only rendered for signed-in visitors — favorites are per user, and the API
 * rejects anonymous callers — so the caller decides whether to show it at all.
 */
export function FavoriteButton({ itemId }: FavoriteButtonProps) {
  const { t } = useLanguage();
  const { isFavorite, isLoading } = useIsFavorite(itemId);
  const toggleFavorite = useToggleFavorite();

  const label = isFavorite ? t('favorites.remove') : t('favorites.add');

  return (
    <Tooltip label={label}>
      <ActionIcon
        variant={isFavorite ? 'filled' : 'light'}
        color={isFavorite ? 'red' : undefined}
        size="lg"
        aria-label={label}
        aria-pressed={isFavorite}
        data-testid="favorite-button"
        // While the current state is still unknown a click would toggle in the
        // wrong direction, so the button waits for it.
        disabled={isLoading}
        loading={toggleFavorite.isPending}
        onClick={() => toggleFavorite.mutate({ itemId, favorite: !isFavorite })}
      >
        <Heart size={18} className={isFavorite ? 'fill-current' : undefined} />
      </ActionIcon>
    </Tooltip>
  );
}
