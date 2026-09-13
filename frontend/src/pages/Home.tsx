import { UpcomingBookingsWidget } from '@/components/bookings/UpcomingBookingsWidget';
import { ItemTileGrid } from '@/components/browse/ItemTileGrid';
import { FavoritesWidget } from '@/components/home/FavoritesWidget';
import { PwaInstallBanner } from '@/components/home/PwaInstallBanner';
import { useLanguage } from '@/contexts/LanguageContext';
import { itemsQueryOptions } from '@/hooks/useItems';
import { BROWSE_PATH } from '@/lib/routes';
import { Button, Text, UnstyledButton } from '@mantine/core';
import { useQueries } from '@tanstack/react-query';
import { ChevronRight, Compass } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

// How many newest items to reveal per "load more" step. Also the initial
// amount shown — enough to fill the grid at every breakpoint without turning
// the start page into a second catalogue up front.
const LOAD_INCREMENT = 12;

const Home = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();

  // Items are fetched a server page at a time (20/page) but revealed a
  // smaller increment at a time; "load more" first reveals items already in
  // hand and only asks the server for another page once those run out.
  // `pageCount` (rather than accumulating results into local state) is the
  // only thing that needs to change on click — the item list itself is
  // derived from the cached pages via `useQueries` on every render.
  const [pageCount, setPageCount] = useState(1);
  const [visibleCount, setVisibleCount] = useState(LOAD_INCREMENT);

  const pageQueries = useQueries({
    queries: Array.from({ length: pageCount }, (_, i) =>
      itemsQueryOptions({ ordering: '-created_at', page: i + 1 }),
    ),
  });

  const isLoading = pageQueries[0]?.isLoading ?? true;
  const isError = pageQueries.some(query => query.isError);
  const lastPageQuery = pageQueries[pageQueries.length - 1];
  const isFetchingNextPage = lastPageQuery?.isFetching && pageCount > 1;

  const items = pageQueries.flatMap(query => query.data?.items ?? []);
  const lastPage = lastPageQuery?.data;
  const hasMoreOnServer = !!lastPage?.pagination.next;
  const hasMoreLoaded = visibleCount < items.length;
  const canLoadMore = hasMoreLoaded || hasMoreOnServer;
  const visibleItems = items.slice(0, visibleCount);

  const handleLoadMore = () => {
    setVisibleCount(count => count + LOAD_INCREMENT);
    if (!hasMoreLoaded && hasMoreOnServer) {
      setPageCount(count => count + 1);
    }
  };

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
          ) : visibleItems.length === 0 ? (
            <Text c="dimmed" className="py-8 text-center">
              {t('index.noItemsFound')}
            </Text>
          ) : (
            <>
              <ItemTileGrid items={visibleItems} />
              {canLoadMore && (
                <div className="flex justify-center pt-2">
                  <Button variant="light" onClick={handleLoadMore} loading={isFetchingNextPage}>
                    {t('home.loadMore')}
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* A way out of the start page's curated slice and into the full,
          filterable catalogue — offered once there's something below to
          scroll past. */}
      <div className="mt-8 flex justify-center border-t border-[var(--mantine-color-default-border)] pt-6">
        <Button
          variant="outline"
          color="green"
          size="md"
          leftSection={<Compass size={18} aria-hidden="true" />}
          onClick={() => navigate(BROWSE_PATH)}
        >
          {t('home.browseAllItems')}
        </Button>
      </div>
    </main>
  );
};

export default Home;
