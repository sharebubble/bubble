import { UpcomingBookingsWidget } from '@/components/bookings/UpcomingBookingsWidget';
import { ItemTileGrid } from '@/components/browse/ItemTileGrid';
import { PwaInstallBanner } from '@/components/home/PwaInstallBanner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useFavorites } from '@/hooks/useFavorites';
import { useItems } from '@/hooks/useItems';
import { BROWSE_PATH, FAVORITES_PATH } from '@/lib/routes';
import { Text, UnstyledButton } from '@mantine/core';
import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// How many of the newest items to surface as tiles on the start page. Enough to
// fill the grid at every breakpoint without turning it into a second catalogue.
const NEWEST_LIMIT = 12;

// The favorites row is a reminder of what was marked most recently, not the
// whole list — that lives behind "view all".
const FAVORITES_LIMIT = 5;

type SectionHeaderProps = {
  title: string;
  onViewAll: () => void;
  viewAllLabel: string;
};

const SectionHeader = ({ title, onViewAll, viewAllLabel }: SectionHeaderProps) => (
  <UnstyledButton onClick={onViewAll} className="flex w-full items-center gap-2 text-left">
    <Text component="span" fw={700} size="lg" className="flex-1">
      {title}
    </Text>
    <Text component="span" size="sm" c="green.6" className="flex items-center gap-0.5">
      {viewAllLabel}
      <ChevronRight size={16} aria-hidden="true" />
    </Text>
  </UnstyledButton>
);

const Home = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const { data, isLoading, isError } = useItems({ ordering: '-created_at', page: 1 });
  const newestItems = (data?.items ?? []).slice(0, NEWEST_LIMIT);

  // Already ordered newest-marked-first by the API.
  const { data: favorites } = useFavorites();
  const recentFavorites = (favorites ?? []).slice(0, FAVORITES_LIMIT);

  return (
    <main className="container mx-auto max-w-6xl px-4 py-4 md:py-6">
      <PwaInstallBanner />

      {/* Single column on small screens (bookings first); on large screens the
          bookings rail sits beside the item grid. */}
      <div className="grid gap-5 lg:grid-cols-3 lg:items-start">
        <UpcomingBookingsWidget className="lg:sticky lg:top-4" />

        <div className="space-y-5 lg:col-span-2">
          {/* Favorites — only worth a row once there is something in it. */}
          {recentFavorites.length > 0 && (
            <section className="space-y-3">
              <SectionHeader
                title={t('favorites.title')}
                onViewAll={() => navigate(FAVORITES_PATH)}
                viewAllLabel={t('home.viewAll')}
              />
              <ItemTileGrid items={recentFavorites.map(favorite => favorite.item_detail)} />
            </section>
          )}

          <section className="space-y-3">
            <SectionHeader
              title={t('home.newestItems')}
              onViewAll={() => navigate(BROWSE_PATH)}
              viewAllLabel={t('home.viewAll')}
            />

            {isLoading ? (
              <Text c="dimmed" className="py-8 text-center">
                {t('index.loadingItems')}
              </Text>
            ) : isError ? (
              <Text c="red" className="py-8 text-center">
                {t('common.loadingError')}
              </Text>
            ) : newestItems.length === 0 ? (
              <Text c="dimmed" className="py-8 text-center">
                {t('index.noItemsFound')}
              </Text>
            ) : (
              <ItemTileGrid items={newestItems} />
            )}
          </section>
        </div>
      </div>
    </main>
  );
};

export default Home;
