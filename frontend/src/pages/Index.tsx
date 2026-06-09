import { BrowseNav } from '@/components/browse/BrowseNav';
import { ItemCard } from '@/components/browse/ItemCard';
import { AddToCollectionPopover } from '@/components/collections/AddToCollectionPopover';
import { getStatusColor, getStatusLabel } from '@/components/items/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLanguage } from '@/contexts/LanguageContext';
import { type ItemCategoryFilter } from '@/hooks/types';
import { useFederatedItems } from '@/hooks/useFederatedItems';
import { useItems } from '@/hooks/useItems';
import { getCategoryIcon } from '@/lib/categoryIcons';
import { formatPrice } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import { cn } from '@/lib/utils';
import {
  type CategoryEnum,
  type ConditionEnum,
  type SalesTypeEnum,
  type StatusB0aEnum,
} from '@/services/django';
import { ChevronLeft, ChevronRight, Grid3X3, List } from 'lucide-react';
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

const SALES_TYPE_BADGE_COLORS: Partial<Record<SalesTypeEnum, string>> = {
  sell: 'bg-primary text-primary-foreground',
  donate: 'bg-success text-success-foreground',
  borrow: 'bg-success text-success-foreground',
  rent: 'bg-info text-info-foreground',
  want_buy: 'bg-muted text-muted-foreground border border-border',
  want_rent: 'bg-muted text-muted-foreground border border-border',
};

const salesTypeBadgeColor = (st: SalesTypeEnum | undefined): string =>
  (st && SALES_TYPE_BADGE_COLORS[st]) || 'bg-muted text-muted-foreground';

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
          <p className="text-destructive">{t('common.loadingError')}</p>
        </div>
      </main>
    );
  }

  if (isFederatedScope ? federatedQuery.isLoading : itemsQuery.isLoading) {
    return (
      <main className="container mx-auto px-4 py-8">
        <div className="text-center">
          <p className="text-destructive">{t('index.loadingItems')}</p>
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

  const pagination = totalPages > 1 && (
    <div className="flex items-center justify-center gap-2 pt-8">
      <Button
        variant="outline"
        size="sm"
        onClick={() => handlePageChange(currentPage - 1)}
        disabled={currentPage === 1}
      >
        <ChevronLeft className="h-4 w-4 mr-1" />
        {t('index.previous')}
      </Button>
      <div className="flex items-center gap-2">
        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
          let pageNum: number;
          if (totalPages <= 5) pageNum = i + 1;
          else if (currentPage <= 3) pageNum = i + 1;
          else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
          else pageNum = currentPage - 2 + i;
          return (
            <Button
              key={pageNum}
              variant={currentPage === pageNum ? 'default' : 'outline'}
              size="sm"
              onClick={() => handlePageChange(pageNum)}
            >
              {pageNum}
            </Button>
          );
        })}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => handlePageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
      >
        {t('index.next')}
        <ChevronRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );

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

        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-foreground">
            {searchQuery
              ? t('index.searchResults').replace('{query}', searchQuery)
              : selectedCategory === 'all'
                ? t('index.allItems')
                : t('index.categoryItems').replace('{category}', selectedCategory)}
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {t('index.itemsFound').replace('{count}', String(totalCount))}
            </span>
            <div className="flex items-center gap-1 border rounded-lg p-1">
              <Button
                variant={viewMode === 'list' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => toggleViewMode('list')}
                className="h-8 w-8 p-0"
                title={t('index.viewList')}
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'cards' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => toggleViewMode('cards')}
                className="h-8 w-8 p-0"
                title={t('index.viewGrid')}
              >
                <Grid3X3 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16"></TableHead>
                  <TableHead>{t('item.name')}</TableHead>
                  <TableHead>{t('item.category')}</TableHead>
                  <TableHead>{t('item.salesType.label')}</TableHead>
                  <TableHead>{t('item.condition')}</TableHead>
                  <TableHead>{t('item.price')}</TableHead>
                  <TableHead>{t('item.createdAt')}</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {localItems.map(item => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/item/${item.id}`)}
                  >
                    <TableCell>
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
                    </TableCell>
                    <TableCell>
                      <div className="font-medium max-w-56 truncate">{item.name}</div>
                      {item.description && (
                        <div className="text-xs text-muted-foreground truncate max-w-56">
                          {item.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {t(`categories.${item.category}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {item.sales_type && (
                        <Badge
                          className={cn(
                            salesTypeBadgeColor(item.sales_type as SalesTypeEnum),
                            'text-xs',
                          )}
                        >
                          {t(`item.salesType.badge.${item.sales_type}`)}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {typeof item.status !== 'undefined' && item.status !== null && (
                        <Badge
                          className={cn(getStatusColor(item.status as StatusB0aEnum), 'text-xs')}
                        >
                          {getStatusLabel(item.status as StatusB0aEnum)
                            ? t(`status.${getStatusLabel(item.status as StatusB0aEnum)}`)
                            : ''}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium whitespace-nowrap">
                        {item.price ? formatPrice(item.price, item.price_currency) : '—'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(item.created_at, language)}
                      </div>
                    </TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <AddToCollectionPopover itemId={item.id} iconOnly />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
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

        {pagination}
      </div>
    </main>
  );
};

export default Index;
