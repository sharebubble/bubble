import { BrowseNav } from '@/components/browse/BrowseNav';
import { ItemCard } from '@/components/browse/ItemCard';
import { AddToCollectionPopover } from '@/components/collections/AddToCollectionPopover';
import {
  getSalesTypeBadgeProps,
  getStatusLabel,
  getStatusMantineColor,
} from '@/components/items/status';
import { useLanguage } from '@/contexts/LanguageContext';
import { type ItemCategoryFilter } from '@/hooks/types';
import { useFederatedItems } from '@/hooks/useFederatedItems';
import { useItems } from '@/hooks/useItems';
import { getCategoryIcon } from '@/lib/categoryIcons';
import { formatPrice } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import {
  type CategoryEnum,
  type ConditionEnum,
  type SalesTypeEnum,
  type StatusB0aEnum,
} from '@/services/django';
import { Badge, Group, Pagination, SegmentedControl, Table, Text } from '@mantine/core';
import { Grid3X3, List } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BrowseItemsPageFilters = {
  status?: StatusB0aEnum | StatusB0aEnum[];
  minPrice?: number;
  maxPrice?: number;
  salesTypes?: SalesTypeEnum[];
};

type SortField = 'name' | 'price' | 'date';
type SortDir = 'asc' | 'desc';
type Scope = 'local' | 'federated' | 'all';

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;
const FEDERATED_PAGE_SIZE = 50;
// by default, show 'new' and 'used' items, don't show 'broken' items
const DEFAULT_CONDITIONS: ConditionEnum[] = [0, 1];
// statuses that count as "available": Available (2) and Reserved (3)
const AVAILABLE_STATUSES: StatusB0aEnum[] = [2, 3];
const LS_KEY = 'indexViewMode';

const VALID_CATEGORIES: ItemCategoryFilter[] = [
  'all',
  'books',
  'clothing',
  'electronics',
  'furniture',
  'garden',
  'kitchen',
  'other',
  'rooms',
  'sports',
  'tools',
  'toys',
  'vehicles',
] satisfies (CategoryEnum | 'all')[];

const VALID_CONDITIONS: ConditionEnum[] = [0, 1, 2];
const VALID_SORT_FIELDS: SortField[] = ['name', 'price', 'date'];
const VALID_SCOPES = ['local', 'federated', 'all'] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const Index = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('cards');

  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY) as 'list' | 'cards' | null;
    if (saved) setViewMode(saved);
  }, []);

  // ---------------------------------------------------------------------------
  // URL param parsing
  // ---------------------------------------------------------------------------

  const params = new URLSearchParams(location.search);
  const typeParam = params.get('type');
  const searchQuery = params.get('search') || undefined;
  const currentPage = Number(params.get('page') ?? '1') || 1;

  const itemFilters: BrowseItemsPageFilters | undefined = (() => {
    if (typeParam === 'buy') return { salesTypes: ['sell', 'donate'] };
    if (typeParam === 'rent') return { salesTypes: ['rent', 'borrow'] };
    if (typeParam === 'wanted') return { salesTypes: ['want_buy', 'want_rent'] };
    return undefined;
  })();

  const categoryParam = params.get('category') as ItemCategoryFilter | null;
  const selectedCategory: ItemCategoryFilter =
    categoryParam && VALID_CATEGORIES.includes(categoryParam) ? categoryParam : 'all';

  const onlyAvailable = (params.get('available') ?? '1') !== '0';

  const conditionsParam = params.get('conditions');
  const selectedConditions: ConditionEnum[] =
    conditionsParam !== null
      ? conditionsParam
          .split(',')
          .map(Number)
          .filter((n): n is ConditionEnum => (VALID_CONDITIONS as number[]).includes(n))
      : DEFAULT_CONDITIONS;

  const sortFieldParam = params.get('sortField');
  const sortDirParam = params.get('sortDir');
  const sortField: SortField = VALID_SORT_FIELDS.includes(sortFieldParam as SortField)
    ? (sortFieldParam as SortField)
    : 'date';
  const sortDir: SortDir =
    sortDirParam === 'asc' || sortDirParam === 'desc'
      ? sortDirParam
      : sortField === 'date'
        ? 'desc'
        : 'asc';
  const ordering = (() => {
    const prefix = sortDir === 'desc' ? '-' : '';
    if (sortField === 'name') return `${prefix}name`;
    if (sortField === 'price') return `${prefix}price`;
    return `${prefix}created_at`;
  })();

  const scopeParam = params.get('scope') as Scope | null;
  const scope: Scope =
    scopeParam && (VALID_SCOPES as readonly string[]).includes(scopeParam) ? scopeParam : 'local';
  const isFederatedScope = scope === 'federated' || scope === 'all';

  // ---------------------------------------------------------------------------
  // Navigation helpers
  // ---------------------------------------------------------------------------

  /** Update URL search params and navigate, deleting 'page' by default. Pass null to delete a key. */
  const navWith = (updates: Record<string, string | null>) => {
    const p = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    p.delete('page');
    navigate(`/?${p.toString()}`);
  };

  const handleScopeChange = (newScope: Scope) =>
    navWith({ scope: newScope === 'local' ? null : newScope });

  const handleSortChange = (field: SortField, dir: SortDir) =>
    navWith({ sortField: field, sortDir: dir });

  const handleCategoryChange = (category: ItemCategoryFilter) =>
    navWith({ category: category === 'all' ? null : category });

  const handleOnlyAvailableChange = (value: boolean) => navWith({ available: value ? null : '0' });

  const handleConditionsChange = (conditions: ConditionEnum[]) => {
    const sorted = [...conditions].sort();
    const isDefault =
      sorted.length === DEFAULT_CONDITIONS.length &&
      sorted.every((v, i) => v === DEFAULT_CONDITIONS[i]);
    navWith({ conditions: isDefault ? null : sorted.join(',') });
  };

  const handlePageChange = (newPage: number) => {
    const p = new URLSearchParams(location.search);
    p.set('page', String(newPage));
    navigate(`/?${p.toString()}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleViewMode = (mode: 'list' | 'cards') => {
    setViewMode(mode);
    localStorage.setItem(LS_KEY, mode);
  };

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  const conditions: ConditionEnum[] | undefined =
    typeParam === 'buy' && selectedConditions.length > 0 ? selectedConditions : undefined;

  const itemsQuery = useItems({
    category: selectedCategory === 'all' ? undefined : selectedCategory,
    conditions,
    search: searchQuery,
    page: currentPage,
    status: itemFilters?.status ?? (onlyAvailable ? AVAILABLE_STATUSES : undefined),
    minPrice: itemFilters?.minPrice,
    maxPrice: itemFilters?.maxPrice,
    salesTypes: itemFilters?.salesTypes,
    ordering,
  });

  const federatedQuery = useFederatedItems(
    isFederatedScope
      ? {
          search: searchQuery,
          scope,
          category: selectedCategory === 'all' ? undefined : selectedCategory,
          salesType: itemFilters?.salesTypes?.[0],
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
        <BrowseNav
          selectedConditions={selectedConditions}
          selectedCategory={selectedCategory}
          onSelectedConditionsChange={handleConditionsChange}
          onSelectedCategoryChange={handleCategoryChange}
          sortField={sortField}
          sortDir={sortDir}
          onSortChange={handleSortChange}
          scope={scope}
          onScopeChange={handleScopeChange}
          onlyAvailable={onlyAvailable}
          onOnlyAvailableChange={handleOnlyAvailableChange}
        />

        <Group justify="space-between" align="center">
          <Text size="sm" c="dimmed">
            {t('index.itemsFound').replace('{count}', String(totalCount))}
          </Text>
          <SegmentedControl
            value={viewMode}
            onChange={value => toggleViewMode(value as 'list' | 'cards')}
            data={[
              { label: <List size={16} />, value: 'list' },
              { label: <Grid3X3 size={16} />, value: 'cards' },
            ]}
            color="green"
            styles={{
              label: { padding: 8 },
              indicator: { boxShadow: 'none' },
            }}
          />
        </Group>

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
          <div className="rounded-lg border">
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th className="w-16"></Table.Th>
                  <Table.Th>{t('item.name')}</Table.Th>
                  <Table.Th>{t('item.category')}</Table.Th>
                  <Table.Th>{t('item.salesType.label')}</Table.Th>
                  <Table.Th>{t('item.condition')}</Table.Th>
                  <Table.Th>{t('item.price')}</Table.Th>
                  <Table.Th>{t('item.createdAt')}</Table.Th>
                  <Table.Th className="w-10"></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {localItems.map(item => (
                  <Table.Tr
                    key={item.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/item/${item.id}`)}
                  >
                    <Table.Td>
                      <div className="w-10 h-10 rounded-md overflow-hidden shrink-0">
                        {item.first_image ? (
                          <img
                            src={item.first_image}
                            alt={item.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          (() => {
                            const CategoryIcon = getCategoryIcon(item.category);
                            return (
                              <div className="flex h-full w-full items-center justify-center bg-muted">
                                <CategoryIcon className="h-5 w-5 text-muted-foreground/50" />
                              </div>
                            );
                          })()
                        )}
                      </div>
                    </Table.Td>
                    <Table.Td>
                      <div className="font-medium max-w-56 truncate">{item.name}</div>
                      {item.description && (
                        <Text size="xs" c="dimmed" truncate className="max-w-56">
                          {item.description}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="outline" color="gray" size="sm">
                        {t(`categories.${item.category}`)}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {item.sales_type && (
                        <Badge
                          {...getSalesTypeBadgeProps(item.sales_type as SalesTypeEnum)}
                          size="sm"
                        >
                          {t(`item.salesType.badge.${item.sales_type}`)}
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {typeof item.status !== 'undefined' && item.status !== null && (
                        <Badge
                          color={getStatusMantineColor(item.status as StatusB0aEnum)}
                          size="sm"
                        >
                          {getStatusLabel(item.status as StatusB0aEnum)
                            ? t(`status.${getStatusLabel(item.status as StatusB0aEnum)}`)
                            : ''}
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={500} className="whitespace-nowrap">
                        {item.price ? formatPrice(item.price, item.price_currency) : '—'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed" className="whitespace-nowrap">
                        {formatDate(item.created_at, language)}
                      </Text>
                    </Table.Td>
                    <Table.Td onClick={e => e.stopPropagation()}>
                      <AddToCollectionPopover itemId={item.id} iconOnly />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {localItems.map(item => (
              <ItemCard
                key={item.id}
                id={item.id}
                title={item.name}
                description={item.description || ''}
                category={item.category}
                condition={item.condition === 0 ? 'new' : item.condition === 1 ? 'used' : 'broken'}
                status={item.status}
                salesType={item.sales_type}
                price={item.price ? parseFloat(item.price) : undefined}
                priceCurrency={item.price_currency}
                location="Location not set"
                imageUrl={item.first_image || undefined}
                owner={item.user}
                createdAt={item.created_at}
                isFavorited={false}
                rentalOpenEnd={item.rental_open_end ?? false}
                rentalSelfService={item.rental_self_service ?? false}
              />
            ))}
          </div>
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

export default Index;
