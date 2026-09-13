import { UpcomingBookingsWidget } from '@/components/bookings/UpcomingBookingsWidget';
import { ItemTileGrid } from '@/components/browse/ItemTileGrid';
import { FavoritesWidget } from '@/components/home/FavoritesWidget';
import { PwaInstallBanner } from '@/components/home/PwaInstallBanner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useItems } from '@/hooks/useItems';
import { BROWSE_PATH } from '@/lib/routes';
import { Text, UnstyledButton } from '@mantine/core';
import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// How many of the newest items to surface as tiles on the start page. Enough to
// fill the grid at every breakpoint without turning it into a second catalogue.
const NEWEST_LIMIT = 12;

const Home = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const { data, isLoading, isError } = useItems({ ordering: '-created_at', page: 1 });
  const newestItems = (data?.items ?? []).slice(0, NEWEST_LIMIT);

  return (
    <main className="container mx-auto max-w-6xl px-4 py-4 md:py-6">
      <PwaInstallBanner />

      {/* Single column on small screens (bookings/favorites first); on large
          screens the sidebar sits beside the item grid. */}
      <div className="grid gap-5 lg:grid-cols-3 lg:items-start">
        <div className="flex flex-col gap-5 lg:sticky lg:top-4">
          <UpcomingBookingsWidget />
          <FavoritesWidget />
        </div>

        <section className="space-y-3 lg:col-span-2">
          <UnstyledButton
            onClick={() => navigate(BROWSE_PATH)}
            className="flex w-full items-center gap-2 text-left"
          >
            <Text component="span" fw={700} size="lg" className="flex-1">
              {t('home.newestItems')}
            </Text>
            <Text component="span" size="sm" c="green.6" className="flex items-center gap-0.5">
              {t('home.viewAll')}
              <ChevronRight size={16} aria-hidden="true" />
            </Text>
          </UnstyledButton>

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
    </main>
  );
};

export default Home;
