import { type ItemCategoryFilter } from '@/hooks/types';
import { BROWSE_PATH } from '@/lib/routes';
import {
  type CategoryEnum,
  type ConditionEnum,
  type SalesTypeEnum,
  type Status7D3Enum,
} from '@/services/django';
import { useLocation, useNavigate } from 'react-router-dom';

export type SortField = 'relevance' | 'name' | 'price' | 'date';
export type SortDir = 'asc' | 'desc';
export type Scope = 'local' | 'federated' | 'all';
export type SalesTypeFilter = 'buy' | 'rent' | 'wanted';

const DEFAULT_CONDITIONS: ConditionEnum[] = [0, 1];
const VALID_CONDITIONS: ConditionEnum[] = [0, 1, 2];
const VALID_SORT_FIELDS: SortField[] = ['relevance', 'name', 'price', 'date'];
const VALID_SCOPES = ['local', 'federated', 'all'] as const;
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

// Availability facet (header search) → item statuses it maps to. Sold and
// archived items are out of circulation, so browse never offers them.
const AVAILABILITY_STATUSES = {
  available: [2, 3],
  rented: [4],
} satisfies Record<string, Status7D3Enum[]>;
type Availability = keyof typeof AVAILABILITY_STATUSES;

const parsePrice = (raw: string | null): number | undefined => {
  if (raw === null || raw === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
};

export const useBrowseParams = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const params = new URLSearchParams(location.search);

  // --- sales type / item filters ---
  const typeParam = params.get('type') as SalesTypeFilter | null;
  const salesTypes: SalesTypeEnum[] | undefined = (() => {
    if (typeParam === 'buy') return ['sell', 'donate'];
    if (typeParam === 'rent') return ['rent', 'borrow'];
    if (typeParam === 'wanted') return ['want_buy', 'want_rent'];
    return undefined;
  })();

  // --- pagination ---
  const currentPage = Number(params.get('page') ?? '1') || 1;

  // --- category ---
  const categoryParam = params.get('category') as ItemCategoryFilter | null;
  const selectedCategory: ItemCategoryFilter =
    categoryParam && VALID_CATEGORIES.includes(categoryParam) ? categoryParam : 'all';

  // --- search ---
  const searchQuery = params.get('search') || undefined;

  // --- owner / collection facets ---
  const ownerParam = params.get('owner') || undefined;
  const collectionParam = params.get('collection') || undefined;

  // --- availability facet ---
  const availabilityParam = params.get('availability');
  const availability: Availability | undefined =
    availabilityParam &&
    Object.prototype.hasOwnProperty.call(AVAILABILITY_STATUSES, availabilityParam)
      ? (availabilityParam as Availability)
      : undefined;

  // --- price filters ---
  // "free" restricts to null/zero-price items and wins over explicit min/max bounds.
  const freeOnly = params.get('free') === '1';
  const minPrice = freeOnly ? undefined : parsePrice(params.get('minPrice'));
  const maxPrice = freeOnly ? undefined : parsePrice(params.get('maxPrice'));

  // --- condition filter ---
  const conditionsParam = params.get('conditions');
  const selectedConditions: ConditionEnum[] =
    conditionsParam !== null
      ? conditionsParam
          .split(',')
          .map(Number)
          .filter((n): n is ConditionEnum => (VALID_CONDITIONS as number[]).includes(n))
      : DEFAULT_CONDITIONS;
  // Condition filtering only applies to buy/sell items.
  const conditions: ConditionEnum[] | undefined =
    typeParam === 'buy' && selectedConditions.length > 0 ? selectedConditions : undefined;

  // --- status filter ---
  // Availability facet wins; otherwise fall through (no status restriction).
  const statusFilter: Status7D3Enum | Status7D3Enum[] | undefined = availability
    ? AVAILABILITY_STATUSES[availability]
    : undefined;

  // --- sort ---
  const sortFieldParam = params.get('sortField');
  const sortDirParam = params.get('sortDir');
  // Searching defaults to relevance (title matches first); browsing without a
  // term has nothing to rank, so it stays newest-first. Relevance is only
  // offered while a term is active.
  const defaultSortField: SortField = searchQuery ? 'relevance' : 'date';
  const requestedSortField = VALID_SORT_FIELDS.includes(sortFieldParam as SortField)
    ? (sortFieldParam as SortField)
    : defaultSortField;
  const sortField: SortField =
    requestedSortField === 'relevance' && !searchQuery ? 'date' : requestedSortField;
  const sortDir: SortDir =
    sortDirParam === 'asc' || sortDirParam === 'desc'
      ? sortDirParam
      : sortField === 'date'
        ? 'desc'
        : 'asc';

  const ordering = (() => {
    const prefix = sortDir === 'desc' ? '-' : '';
    // `relevance` already means best-first, so it carries no direction prefix.
    if (sortField === 'relevance') return 'relevance';
    if (sortField === 'name') return `${prefix}name`;
    if (sortField === 'price') return `${prefix}price`;
    return `${prefix}created_at`;
  })();

  // --- scope ---
  const scopeParam = params.get('scope') as Scope | null;
  const scope: Scope =
    scopeParam && (VALID_SCOPES as readonly string[]).includes(scopeParam) ? scopeParam : 'local';
  const isFederatedScope = scope === 'federated' || scope === 'all';

  // --- view mode ---
  // Lives in the URL so the browsing view survives a refresh.
  const viewMode: 'list' | 'cards' = params.get('view') === 'list' ? 'list' : 'cards';

  // ---------------------------------------------------------------------------
  // Navigation helpers
  // ---------------------------------------------------------------------------

  const browsePath = (p: URLSearchParams) => {
    const search = p.toString();
    return `${BROWSE_PATH}${search ? `?${search}` : ''}`;
  };

  /** Update URL search params and navigate, resetting page. Pass null to delete a key. */
  const navWith = (updates: Record<string, string | null>) => {
    const p = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    p.delete('page');
    navigate(browsePath(p));
  };

  const setConditions = (conditions: ConditionEnum[]) => {
    const sorted = [...conditions].sort();
    const isDefault =
      sorted.length === DEFAULT_CONDITIONS.length &&
      sorted.every((v, i) => v === DEFAULT_CONDITIONS[i]);
    navWith({ conditions: isDefault ? null : sorted.join(',') });
  };

  const setSort = (field: SortField, dir: SortDir) => navWith({ sortField: field, sortDir: dir });

  const setScope = (newScope: Scope) => navWith({ scope: newScope === 'local' ? null : newScope });

  const setViewMode = (mode: 'list' | 'cards') => {
    const p = new URLSearchParams(location.search);
    if (mode === 'cards') p.delete('view');
    else p.set('view', mode);
    navigate(browsePath(p), { replace: true });
  };

  const setPage = (page: number) => {
    const p = new URLSearchParams(location.search);
    p.set('page', String(page));
    navigate(browsePath(p));
  };

  return {
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
    selectedConditions,
    conditions,
    statusFilter,
    sortField,
    sortDir,
    ordering,
    scope,
    isFederatedScope,
    viewMode,
    setConditions,
    setSort,
    setScope,
    setViewMode,
    setPage,
  };
};
