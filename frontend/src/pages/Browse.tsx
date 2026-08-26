import { BrowseNav } from '@/components/browse/BrowseNav';
import { CardsView } from '@/components/browse/CardsView';
import { ItemCard } from '@/components/browse/ItemCard';
import { ListView } from '@/components/browse/ListView';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBrowseParams } from '@/hooks/useBrowseParams';
import { useFederatedItems } from '@/hooks/useFederatedItems';
import { useItems } from '@/hooks/useItems';
import { type SalesTypeEnum } from '@/services/django';
import { Pagination, Text } from '@mantine/core';

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;
const FEDERATED_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const Browse = () => {
  const { t } = useLanguage();

  const {
    typeParam,
    salesTypes,
    currentPage,
    selectedCategory,
    searchQuery,
    ownerParam,
    collectionParam,
    freeOnly,
    minPrice,
    maxPrice,
    conditions,
    statusFilter,
    ordering,
    scope,
    isFederatedScope,
    viewMode,
    setPage,
  } = useBrowseParams();

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const itemsQuery = useItems({
    category: selectedCategory === 'all' ? undefined : selectedCategory,
    conditions,
    search: searchQuery,
    page: currentPage,
    status: statusFilter,
    minPrice,
    maxPrice,
    free: freeOnly ? true : undefined,
    salesTypes,
    ordering,
    owner: ownerParam,
    collection: collectionParam,
  });

  const federatedQuery = useFederatedItems(
    isFederatedScope
      ? {
          search: searchQuery,
          scope,
          category: selectedCategory === 'all' ? undefined : selectedCategory,
          salesType: salesTypes?.[0],
          limit: FEDERATED_PAGE_SIZE,
          offset: (currentPage - 1) * FEDERATED_PAGE_SIZE,
        }
      : undefined,
  );

  // ---------------------------------------------------------------------------
  // Loading / error states
  // ---------------------------------------------------------------------------

  if (isFederatedScope ? federatedQuery.error : itemsQuery.error) {
    return (
      <main className="container mx-auto px-4 py-8">
        <div className="text-center">
          <Text c="red">{t('common.loadingError')}</Text>
        </div>
      </main>
    );
  }

  if (isFederatedScope ? federatedQuery.isLoading : itemsQuery.isLoading) {
    return (
      <main className="container mx-auto px-4 py-8">
        <div className="text-center">
          <Text c="red">{t('index.loadingItems')}</Text>
        </div>
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const totalCount = isFederatedScope
    ? (federatedQuery.data?.pagination.count ?? 0)
    : (itemsQuery.data?.pagination.count ?? 0);
  const totalPages = Math.ceil(totalCount / (isFederatedScope ? FEDERATED_PAGE_SIZE : PAGE_SIZE));

  const federatedItems = federatedQuery.data?.items ?? [];
  const localItems = itemsQuery.data?.items ?? [];

  return (
    <main className="container mx-auto px-4 py-4">
      <div className="space-y-4">
        <BrowseNav totalCount={totalCount} />

        {isFederatedScope ? (
          federatedItems.length === 0 ? (
            <div className="text-center py-8">
              <p>{t('index.noItemsFound')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {federatedItems.map(item => (
                <ItemCard
                  key={item.ap_id ?? item.id}
                  id={item.id}
                  title={item.name}
                  description={item.description || ''}
                  category={item.category}
                  condition={
                    item.condition === 'new' ? 'new' : item.condition === 'used' ? 'used' : 'broken'
                  }
                  salesType={item.sales_type as SalesTypeEnum | undefined}
                  price={item.price ? parseFloat(item.price) : undefined}
                  priceCurrency={item.price_currency}
                  rentalPeriod={item.rental_period}
                  location=""
                  imageUrl={item.first_image_url ?? undefined}
                  createdAt=""
                  remoteInstance={item.source === 'remote' ? item.instance : null}
                />
              ))}
            </div>
          )
        ) : localItems.length === 0 ? (
          <div className="text-center py-8">
            <p>{t('index.noItemsFound')}</p>
          </div>
        ) : viewMode === 'list' ? (
          <ListView items={localItems} />
        ) : (
          <CardsView items={localItems} />
        )}

        {totalPages > 1 && (
          <div className="flex justify-center pt-3">
            <Pagination total={totalPages} value={currentPage} onChange={handlePageChange} />
          </div>
        )}
      </div>
    </main>
  );
};

export default Browse;
