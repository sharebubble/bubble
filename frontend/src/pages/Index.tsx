import { BrowseNav } from '@/components/browse/BrowseNav';
import { ItemCard } from '@/components/browse/ItemCard';
import { AddToCollectionPopover } from '@/components/collections/AddToCollectionPopover';
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
import { useItems } from '@/hooks/useItems';
import { useFederatedItems } from '@/hooks/useFederatedItems';
import { type ItemCategoryFilter } from '@/hooks/types';
import { getCategoryIcon } from '@/lib/categoryIcons';
import { formatPrice } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import { cn } from '@/lib/utils';
import { type StatusB0aEnum, type SalesTypeEnum, type CategoryEnum } from '@/services/django';
import { type ConditionEnum } from '@/services/django';
import { getStatusColor, getStatusLabel } from '@/components/items/status';
import { ChevronLeft, ChevronRight, Grid3X3, List } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

type BrowseItemsPageFilters = {
  status?: StatusB0aEnum | StatusB0aEnum[];
  minPrice?: number;
  maxPrice?: number;
  salesTypes?: SalesTypeEnum[];
};

const PAGE_SIZE = 20;
// by default, show 'new' and 'used' items, don't show 'broken' items
const DEFAULT_CONDITIONS: ConditionEnum[] = [0, 1];
// statuses that count as "available": Available (2) and Reserved (3)
const AVAILABLE_STATUSES: StatusB0aEnum[] = [2, 3];
const LS_KEY = 'indexViewMode';

const Index = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const params = new URLSearchParams(location.search);
  const typeParam = params.get('type');
  const searchQuery = params.get('search') || undefined;
  const pageParam = params.get('page');
  const currentPage = pageParam ? parseInt(pageParam, 10) : 1;
  let itemFilters: BrowseItemsPageFilters | undefined;
  if (typeParam === 'buy') {
    itemFilters = { salesTypes: ['sell', 'donate'] };
  } else if (typeParam === 'rent') {
    itemFilters = { salesTypes: ['rent', 'borrow'] };
  } else if (typeParam === 'wanted') {
    itemFilters = { salesTypes: ['want_buy', 'want_rent'] };
  }

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
  const categoryParam = params.get('category') as ItemCategoryFilter | null;
  const selectedCategory: ItemCategoryFilter =
    categoryParam && VALID_CATEGORIES.includes(categoryParam) ? categoryParam : 'all';

  const availableParam = params.get('available');
  const onlyAvailable: boolean = availableParam === null ? true : availableParam !== '0';

  const VALID_CONDITIONS: ConditionEnum[] = [0, 1, 2];
  const conditionsParam = params.get('conditions');
  const selectedConditions: ConditionEnum[] =
    conditionsParam !== null
      ? conditionsParam
          .split(',')
          .map(Number)
          .filter((n): n is ConditionEnum => (VALID_CONDITIONS as number[]).includes(n))
      : DEFAULT_CONDITIONS;

  const [viewMode, setViewMode] = useState<'list' | 'cards'>('cards');

  type SortField = 'name' | 'price' | 'date';
  type SortDir = 'asc' | 'desc';

  const VALID_SORT_FIELDS: SortField[] = ['name', 'price', 'date'];
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

  const ordering: string = (() => {
    const prefix = sortDir === 'desc' ? '-' : '';
    if (sortField === 'name') return `${prefix}name`;
    if (sortField === 'price') return `${prefix}price`;
    return `${prefix}created_at`;
  })();

  const VALID_SCOPES = ['local', 'federated', 'all'] as const;
  type Scope = (typeof VALID_SCOPES)[number];
  const scopeParam = params.get('scope') as Scope | null;
  const scope: Scope =
    scopeParam && (VALID_SCOPES as readonly string[]).includes(scopeParam) ? scopeParam : 'local';
  const isFederatedScope = scope === 'federated' || scope === 'all';

  const handleScopeChange = (newScope: Scope) => {
    const newParams = new URLSearchParams(location.search);
    if (newScope === 'local') {
      newParams.delete('scope');
    } else {
      newParams.set('scope', newScope);
    }
    newParams.delete('page');
    navigate(`/?${newParams.toString()}`);
  };

  const handleSortChange = (field: SortField, dir: SortDir) => {
    const newParams = new URLSearchParams(location.search);
    newParams.set('sortField', field);
    newParams.set('sortDir', dir);
    newParams.delete('page');
    navigate(`/?${newParams.toString()}`);
  };

  const handleCategoryChange = (category: ItemCategoryFilter) => {
    const newParams = new URLSearchParams(location.search);
    if (category === 'all') {
      newParams.delete('category');
    } else {
      newParams.set('category', category);
    }
    newParams.delete('page');
    navigate(`/?${newParams.toString()}`);
  };

  const handleOnlyAvailableChange = (value: boolean) => {
    const newParams = new URLSearchParams(location.search);
    if (value) {
      newParams.delete('available');
    } else {
      newParams.set('available', '0');
    }
    newParams.delete('page');
    navigate(`/?${newParams.toString()}`);
  };

  const handleConditionsChange = (conditions: ConditionEnum[]) => {
    const newParams = new URLSearchParams(location.search);
    const sorted = [...conditions].sort();
    if (
      sorted.length === DEFAULT_CONDITIONS.length &&
      sorted.every((v, i) => v === DEFAULT_CONDITIONS[i])
    ) {
      newParams.delete('conditions');
    } else {
      newParams.set('conditions', sorted.join(','));
    }
    newParams.delete('page');
    navigate(`/?${newParams.toString()}`);
  };

  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY) as 'list' | 'cards' | null;
    if (saved) setViewMode(saved);
  }, []);

  const toggleViewMode = (mode: 'list' | 'cards') => {
    setViewMode(mode);
    localStorage.setItem(LS_KEY, mode);
  };

  let conditions: ConditionEnum[] | undefined;
  if (typeParam === 'buy' && selectedConditions.length > 0) {
    conditions = selectedConditions;
  }

  const itemsQuery = useItems({
    category: selectedCategory === 'all' ? undefined : selectedCategory,
    conditions: conditions,
    search: searchQuery,
    page: currentPage,
    status: itemFilters?.status ?? (onlyAvailable ? AVAILABLE_STATUSES : undefined),
    minPrice: itemFilters?.minPrice,
    maxPrice: itemFilters?.maxPrice,
    salesTypes: itemFilters?.salesTypes,
    ordering,
  });

  // Federated query — only fired when scope is 'federated' or 'all'
  const FEDERATED_PAGE_SIZE = 50;
  const federatedOffset = (currentPage - 1) * FEDERATED_PAGE_SIZE;
  const federatedQuery = useFederatedItems(
    isFederatedScope
      ? {
          search: searchQuery,
          scope,
          category: selectedCategory === 'all' ? undefined : selectedCategory,
          salesType: itemFilters?.salesTypes?.[0],
          limit: FEDERATED_PAGE_SIZE,
          offset: federatedOffset,
        }
      : undefined,
  );

  const handlePageChange = (newPage: number) => {
    const newParams = new URLSearchParams(location.search);
    newParams.set('page', String(newPage));
    navigate(`/?${newParams.toString()}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const salesTypeBadgeColor = (st: SalesTypeEnum | undefined) => {
    switch (st) {
      case 'sell':
        return 'bg-primary text-primary-foreground';
      case 'donate':
      case 'borrow':
        return 'bg-success text-success-foreground';
      case 'rent':
        return 'bg-info text-info-foreground';
      case 'want_buy':
      case 'want_rent':
        return 'bg-muted text-muted-foreground border border-border';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

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

  if (isFederatedScope && federatedQuery.isSuccess) {
    const federatedItems = federatedQuery.data.items;
    const totalCount = federatedQuery.data.pagination.count;
    const totalPages = Math.ceil(totalCount / FEDERATED_PAGE_SIZE);

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

          {federatedItems.length === 0 ? (
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
          )}

          {pagination}
        </div>
      </main>
    );
  }

  if (itemsQuery.isSuccess) {
    const totalPages = Math.ceil(itemsQuery.data.pagination.count / PAGE_SIZE);
    const items = itemsQuery.data.items;

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
            if (totalPages <= 5) {
              pageNum = i + 1;
            } else if (currentPage <= 3) {
              pageNum = i + 1;
            } else if (currentPage >= totalPages - 2) {
              pageNum = totalPages - 4 + i;
            } else {
              pageNum = currentPage - 2 + i;
            }

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
                {t('index.itemsFound').replace('{count}', String(itemsQuery.data.pagination.count))}
              </span>
              {/* View mode toggle */}
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

          {items.length === 0 ? (
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
                  {items.map(item => (
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
              {items.map(item => (
                <ItemCard
                  key={item.id}
                  id={item.id}
                  title={item.name}
                  description={item.description || ''}
                  category={item.category}
                  condition={
                    item.condition === 0 ? 'new' : item.condition === 1 ? 'used' : 'broken'
                  }
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
  }
};

export default Index;
