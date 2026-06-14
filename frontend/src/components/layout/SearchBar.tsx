import { useLanguage } from '@/contexts/LanguageContext';
import { useAllCollections } from '@/hooks/useCollections';
import { useCategoryFacets, useItemOwners } from '@/hooks/useSearchFacets';
import { categoryTranslationKeys, getCategoryIcon } from '@/lib/categoryIcons';
import { cn } from '@/lib/utils';
import {
  Button,
  Loader,
  Pill,
  PillsInput,
  Popover,
  ScrollArea,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { BookMarked, Check, CircleDot, Search, Tag, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type Facet = 'owner' | 'collection' | 'category' | 'availability';

const AVAILABILITY_OPTIONS = ['available', 'rented', 'sold'] as const;

const FACET_ICONS: Record<Facet, LucideIcon> = {
  owner: User,
  collection: BookMarked,
  category: Tag,
  availability: CircleDot,
};

// The browse/results page that the header search drives.
const BROWSE_PATH = '/';

interface SearchBarProps {
  /** Whether the owner facet is offered (logged-in users only). */
  showOwner: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SearchBar = ({ showOwner, className }: SearchBarProps) => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

  // Filters only have meaning on the browse page; elsewhere the bar acts as an
  // entry point that navigates to the browse page once a filter or term is set.
  const onBrowse = location.pathname === BROWSE_PATH;
  const currentParams = useMemo(
    () => new URLSearchParams(onBrowse ? location.search : ''),
    [onBrowse, location.search],
  );

  const ownerId = currentParams.get('owner') || undefined;
  const collectionId = currentParams.get('collection') || undefined;
  const categoryValue = currentParams.get('category') || undefined;
  const availabilityValue = currentParams.get('availability') || undefined;
  const searchValue = currentParams.get('search') ?? '';

  const [opened, setOpened] = useState(false);
  const facets: Facet[] = useMemo(
    () =>
      showOwner
        ? ['owner', 'collection', 'category', 'availability']
        : ['collection', 'category', 'availability'],
    [showOwner],
  );
  const [activeFacet, setActiveFacet] = useState<Facet>(facets[0]);
  const [facetQuery, setFacetQuery] = useState('');

  // Free-text item search (mirrors the URL `search` param, debounced).
  const [inputValue, setInputValue] = useState(searchValue);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Adopt the URL value whenever it changes externally (back/forward, chips),
  // without an effect — React's "adjusting state when a prop changes" pattern.
  const [lastSyncedSearch, setLastSyncedSearch] = useState(searchValue);
  if (lastSyncedSearch !== searchValue) {
    setLastSyncedSearch(searchValue);
    setInputValue(searchValue);
  }

  // ---------------------------------------------------------------------------
  // Data for the facet lists
  // ---------------------------------------------------------------------------

  const ownersQuery = useItemOwners({ enabled: (opened && showOwner) || !!ownerId });
  const collectionsQuery = useAllCollections({ enabled: opened || !!collectionId });
  const categoriesQuery = useCategoryFacets({ enabled: opened });

  const resolveOwnerLabel = (id: string) => {
    const owner = ownersQuery.data?.find(o => o.id === id);
    return owner ? owner.name || owner.username : '…';
  };
  const resolveCollectionLabel = (id: string) => {
    const collection = collectionsQuery.data?.find(c => String(c.id) === id);
    return collection ? `${collection.name} (${collection.owner})` : '…';
  };

  // ---------------------------------------------------------------------------
  // URL helpers
  // ---------------------------------------------------------------------------

  const applyParams = useCallback(
    (mutate: (params: URLSearchParams) => void, opts?: { replace?: boolean }) => {
      const params = new URLSearchParams(onBrowse ? location.search : '');
      mutate(params);
      params.delete('page');
      const search = params.toString();
      navigate(
        { pathname: BROWSE_PATH, search: search ? `?${search}` : '' },
        { replace: !!opts?.replace && onBrowse },
      );
    },
    [navigate, onBrowse, location.search],
  );

  const handleSearchChange = (term: string) => {
    setInputValue(term);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      applyParams(
        params => {
          if (term) params.set('search', term);
          else params.delete('search');
        },
        { replace: true },
      );
    }, 300);
  };

  const selectFacet = (key: Facet, value: string) => {
    applyParams(params => params.set(key, value));
    setFacetQuery('');
    setOpened(false);
  };

  const clearFacet = (key: string) => applyParams(params => params.delete(key), { replace: true });

  // ---------------------------------------------------------------------------
  // Active filter chips
  // ---------------------------------------------------------------------------

  const chips: { key: string; label: string }[] = [];
  if (ownerId) chips.push({ key: 'owner', label: resolveOwnerLabel(ownerId) });
  if (collectionId) chips.push({ key: 'collection', label: resolveCollectionLabel(collectionId) });
  if (categoryValue && categoryValue !== 'all')
    chips.push({
      key: 'category',
      label: t(categoryTranslationKeys[categoryValue] ?? categoryValue),
    });
  if (availabilityValue)
    chips.push({ key: 'availability', label: t(`search.availability.${availabilityValue}`) });

  // ---------------------------------------------------------------------------
  // Facet panel rendering
  // ---------------------------------------------------------------------------

  const facetSearchPlaceholder: Record<Facet, string> = {
    owner: t('search.searchOwners'),
    collection: t('search.searchCollections'),
    category: t('search.searchCategories'),
    availability: '',
  };

  const renderRow = (
    key: string,
    {
      icon,
      label,
      meta,
      active,
      onSelect,
    }: {
      icon?: React.ReactNode;
      label: string;
      meta?: string;
      active: boolean;
      onSelect: () => void;
    },
  ) => (
    <UnstyledButton
      key={key}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--mantine-color-default-hover)]',
        active && 'bg-[var(--mantine-color-default-hover)]',
      )}
    >
      {icon}
      <span className="flex-1 truncate text-sm">{label}</span>
      {meta && (
        <Text span size="xs" c="dimmed" className="shrink-0">
          {meta}
        </Text>
      )}
      {active && <Check size={14} className="shrink-0 text-[var(--mantine-color-green-6)]" />}
    </UnstyledButton>
  );

  const renderPanel = () => {
    const query = facetQuery.trim().toLowerCase();

    if (activeFacet === 'availability') {
      return (
        <div className="flex flex-col">
          {AVAILABILITY_OPTIONS.map(value =>
            renderRow(value, {
              icon: <CircleDot size={16} className="text-muted-foreground" />,
              label: t(`search.availability.${value}`),
              active: availabilityValue === value,
              onSelect: () => selectFacet('availability', value),
            }),
          )}
        </div>
      );
    }

    const loading =
      activeFacet === 'owner'
        ? ownersQuery.isLoading
        : activeFacet === 'collection'
          ? collectionsQuery.isLoading
          : categoriesQuery.isLoading;

    let rows: React.ReactNode[] = [];
    if (activeFacet === 'owner') {
      rows = (ownersQuery.data ?? [])
        .filter(
          o =>
            !query ||
            o.username.toLowerCase().includes(query) ||
            o.name.toLowerCase().includes(query),
        )
        .map(o =>
          renderRow(o.id, {
            icon: <User size={16} className="text-muted-foreground" />,
            label: o.name || o.username,
            meta: String(o.item_count),
            active: ownerId === o.id,
            onSelect: () => selectFacet('owner', o.id),
          }),
        );
    } else if (activeFacet === 'collection') {
      rows = (collectionsQuery.data ?? [])
        .filter(c => !query || c.name.toLowerCase().includes(query))
        .map(c =>
          renderRow(String(c.id), {
            icon: <BookMarked size={16} className="text-muted-foreground" />,
            label: c.name,
            meta: `(${c.owner})`,
            active: collectionId === String(c.id),
            onSelect: () => selectFacet('collection', String(c.id)),
          }),
        );
    } else {
      rows = (categoriesQuery.data ?? [])
        .map(facet => {
          const label = t(categoryTranslationKeys[facet.category] ?? facet.category);
          return { facet, label };
        })
        .filter(({ label }) => !query || label.toLowerCase().includes(query))
        .map(({ facet, label }) => {
          const Icon = getCategoryIcon(facet.category);
          return renderRow(facet.category, {
            icon: <Icon size={16} className="text-muted-foreground" />,
            label,
            meta: `(${facet.count})`,
            active: categoryValue === facet.category,
            onSelect: () => selectFacet('category', facet.category),
          });
        });
    }

    return (
      <div className="flex flex-col gap-1.5">
        <TextInput
          size="xs"
          value={facetQuery}
          placeholder={facetSearchPlaceholder[activeFacet]}
          leftSection={<Search size={14} aria-hidden="true" />}
          onChange={e => setFacetQuery(e.currentTarget.value)}
        />
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader size="sm" />
          </div>
        ) : rows.length > 0 ? (
          <ScrollArea.Autosize mah={240} type="hover">
            <div className="flex flex-col pr-1">{rows}</div>
          </ScrollArea.Autosize>
        ) : (
          <Text size="sm" c="dimmed" className="py-3 text-center">
            {t('search.noResults')}
          </Text>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      width="target"
      shadow="md"
      trapFocus={false}
      withinPortal
    >
      <Popover.Target>
        <PillsInput
          size="sm"
          onClick={() => setOpened(true)}
          leftSection={<Search size={16} aria-hidden="true" />}
          className={cn('shadow-soft focus-within:shadow-medium transition-shadow', className)}
        >
          <Pill.Group>
            {chips.map(chip => (
              <Pill
                key={chip.key}
                withRemoveButton
                onRemove={() => clearFacet(chip.key)}
                aria-label={`${t('search.removeFilter')}: ${chip.label}`}
              >
                {chip.label}
              </Pill>
            ))}
            <PillsInput.Field
              value={inputValue}
              placeholder={chips.length > 0 ? '' : t('header.search')}
              onFocus={() => setOpened(true)}
              onChange={e => handleSearchChange(e.currentTarget.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') setOpened(false);
              }}
            />
          </Pill.Group>
        </PillsInput>
      </Popover.Target>

      <Popover.Dropdown p="xs">
        <div className="mb-2 flex flex-wrap gap-1">
          {facets.map(facet => {
            const Icon = FACET_ICONS[facet];
            return (
              <Button
                key={facet}
                size="compact-xs"
                variant={activeFacet === facet ? 'light' : 'subtle'}
                color={activeFacet === facet ? 'green' : 'gray'}
                leftSection={<Icon size={14} aria-hidden="true" />}
                onClick={() => {
                  setActiveFacet(facet);
                  setFacetQuery('');
                }}
              >
                {t(`search.${facet}`)}
              </Button>
            );
          })}
        </div>
        {renderPanel()}
      </Popover.Dropdown>
    </Popover>
  );
};
