import { useLanguage } from '@/contexts/LanguageContext';
import { useFavorites } from '@/hooks/useFavorites';
import { cn } from '@/lib/utils';
import { FAVORITES_PATH } from '@/lib/routes';
import type { FavoriteItem } from '@/services/django';
import { Card, Loader, Text, UnstyledButton } from '@mantine/core';
import { ChevronRight, Heart, Package } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// How many favorites to surface in the compact widget — a reminder of what
// was marked most recently, not the whole list (that's behind "view all").
const WIDGET_LIMIT = 5;

// A single row: just enough to recognise the item and jump to it — a
// thumbnail, its title, and nothing else competing for space.
const FavoriteLine = ({ favorite }: { favorite: FavoriteItem }) => {
  const navigate = useNavigate();
  const item = favorite.item_detail;

  return (
    <UnstyledButton
      onClick={() => navigate(`/item/${item.id}`)}
      className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-left hover:bg-[var(--mantine-color-default-hover)]"
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-sm"
        style={{ background: 'var(--mantine-color-default-hover)' }}
      >
        {item.first_image ? (
          <img src={item.first_image} alt={item.name} className="h-full w-full object-cover" />
        ) : (
          <Package size={16} color="var(--mantine-color-dimmed)" aria-hidden="true" />
        )}
      </div>

      <Text component="span" size="sm" fw={500} truncate className="flex-1">
        {item.name}
      </Text>

      <ChevronRight size={14} color="var(--mantine-color-dimmed)" className="shrink-0" />
    </UnstyledButton>
  );
};

export const FavoritesWidget = ({ className }: { className?: string }) => {
  const { t } = useLanguage();
  const navigate = useNavigate();

  // Already ordered newest-marked-first by the API.
  const { data, isLoading, isError } = useFavorites();
  const favorites = (data ?? []).slice(0, WIDGET_LIMIT);

  // Nothing marked yet — no point taking up sidebar space for an empty box.
  if (!isLoading && !isError && favorites.length === 0) return null;

  return (
    <Card withBorder radius="lg" padding="md" className={cn(className)}>
      <UnstyledButton
        onClick={() => navigate(FAVORITES_PATH)}
        className="mb-3 flex w-full items-center gap-2 text-left"
      >
        <Heart size={18} color="var(--mantine-color-red-6)" aria-hidden="true" />
        <Text component="span" fw={700} size="sm" className="flex-1">
          {t('favorites.title')}
        </Text>
        <ChevronRight size={16} color="var(--mantine-color-dimmed)" aria-hidden="true" />
      </UnstyledButton>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader size="sm" />
        </div>
      ) : isError ? (
        <Text size="sm" c="red" className="py-4 text-center">
          {t('common.loadingError')}
        </Text>
      ) : (
        <div className="flex flex-col gap-1">
          {favorites.map(favorite => (
            <FavoriteLine key={favorite.id} favorite={favorite} />
          ))}
        </div>
      )}
    </Card>
  );
};
