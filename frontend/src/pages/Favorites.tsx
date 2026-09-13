import { CardsView } from '@/components/browse/CardsView';
import { BackButton } from '@/components/layout/BackButton';
import { useLanguage } from '@/contexts/LanguageContext';
import { useFavorites } from '@/hooks/useFavorites';
import { Text, Title } from '@mantine/core';

/**
 * Every item the viewer has marked as favorite, newest mark first.
 *
 * Reached from the profile menu (and from the start page's favorites row).
 */
const Favorites = () => {
  const { t } = useLanguage();
  const { data: favorites, isLoading, isError } = useFavorites();

  const items = (favorites ?? []).map(favorite => favorite.item_detail);

  return (
    <main className="container mx-auto px-4 py-4">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <BackButton />
          <Title order={1} size="h3">
            {t('favorites.title')}
          </Title>
        </div>

        {isLoading ? (
          <Text c="dimmed" className="py-8 text-center">
            {t('index.loadingItems')}
          </Text>
        ) : isError ? (
          <Text c="red" className="py-8 text-center">
            {t('common.loadingError')}
          </Text>
        ) : items.length === 0 ? (
          <Text c="dimmed" className="py-8 text-center">
            {t('favorites.empty')}
          </Text>
        ) : (
          <CardsView items={items} />
        )}
      </div>
    </main>
  );
};

export default Favorites;
