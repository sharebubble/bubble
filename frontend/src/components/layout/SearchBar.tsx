import { useLanguage } from '@/contexts/LanguageContext';
import { useSearchFacets } from '@/hooks/useSearchFacets';
import { categoryTranslationKeys, getCategoryIcon } from '@/lib/categoryIcons';
import { cn } from '@/lib/utils';
import {
  Button,
  Loader,
  NavLink,
  Pill,
  PillsInput,
  Popover,
  ScrollArea,
  Text,
  TextInput,
} from '@mantine/core';
import { BookMarked, CircleDot, Search, Tag, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type Facet = 'category' | 'collection' | 'availability' | 'owner';

const FACET_ICONS: Record<Facet, LucideIcon> = {
  category: Tag,
  collection: BookMarked,
  availability: CircleDot,
  owner: User,
};

// Facets that require an authenticated user (collections are auth-only, owners
// are intentionally hidden from anonymous visitors).
const AUTHED_FACETS: readonly Facet[] = ['collection', 'owner'];

// The browse/results page that the header search drives.
const BROWSE_PATH = '/';

interface SearchBarProps {
  /** Whether the viewer is logged in (gates the collection and owner facets). */
  loggedIn: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SearchBar = ({ loggedIn, className }: SearchBarProps) => {
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
      (['category', 'collection', 'availability', 'owner'] as const).filter(
        facet => loggedIn || !AUTHED_FACETS.includes(facet),
      ),
    [loggedIn],
  );
  const [activeFacet, setActiveFacet] = useState<Facet>(facets[0]);
  const [facetQuery, setFacetQuery] = useState('');

  // Free-text item search (mirrors the URL `search` param, debounced).
  const [inputValue, setInputValue] = useState(searchValue);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Clear any pending debounce on unmount so it can't fire after navigation.
  useEffect(
    () => () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    },
    [],
  );
  // Adopt the URL value whenever it changes externally (back/forward, chips),
  // without an effect — React's "adjusting state when a prop changes" pattern.
  const [lastSyncedSearch, setLastSyncedSearch] = useState(searchValue);
  if (lastSyncedSearch !== searchValue) {
    setLastSyncedSearch(searchValue);
    setInputValue(searchValue);
  }

  // ---------------------------------------------------------------------------
  // Cross-filtered facet data (each facet reflects the other active filters)
  // ---------------------------------------------------------------------------

  const facetsQuery = useSearchFacets(
    {
      category: categoryValue,
      collection: collectionId,
      owner: ownerId,
      availability: availabilityValue,
      search: searchValue || undefined,
    },
    { enabled: opened || !!ownerId || !!collectionId },
  );
  const facetsData = facetsQuery.data;

  const resolveOwnerLabel = (id: string) => {
    const owner = facetsData?.owners.find(o => o.id === id);
    return owner ? owner.name || owner.username : '…';
  };
  const resolveCollectionLabel = (id: string) => {
    const collection = facetsData?.collections.find(c => c.id === id);
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

  // Toggle a facet value: selecting the active value clears it. The popup stays
  // open so the other facets visibly update with the new selection.
  const toggleFacet = (key: Facet, value: string) => {
    const isActive = currentParams.get(key) === value;
    applyParams(params => {
      if (isActive) params.delete(key);
      else params.set(key, value);
    });
    setFacetQuery('');
  };

  const clearFacet = (key: string) => applyParams(params => params.delete(key), { replace: true });

  // ---------------------------------------------------------------------------
  // Active filter chips (ordered like the facet tabs)
  // ---------------------------------------------------------------------------

  const chips: { key: string; label: string }[] = [];
  if (categoryValue && categoryValue !== 'all')
    chips.push({
      key: 'category',
      label: t(categoryTranslationKeys[categoryValue] ?? categoryValue),
    });
  if (collectionId) chips.push({ key: 'collection', label: resolveCollectionLabel(collectionId) });
  if (availabilityValue)
    chips.push({ key: 'availability', label: t(`search.availability.${availabilityValue}`) });
  if (ownerId) chips.push({ key: 'owner', label: resolveOwnerLabel(ownerId) });

  // ---------------------------------------------------------------------------
  // Facet panel rendering
  // ---------------------------------------------------------------------------

  const facetSearchPlaceholder: Record<Facet, string> = {
    category: t('search.searchCategories'),
    collection: t('search.searchCollections'),
    availability: '',
    owner: t('search.searchOwners'),
  };

  const renderRow = (
    key: string,
    {
      icon,
      label,
      secondary,
      meta,
      active,
      onSelect,
    }: {
      icon: React.ReactNode;
      label: string;
      secondary?: string;
      meta?: string;
      active: boolean;
      onSelect: () => void;
    },
  ) => (
    <NavLink
      key={key}
      component="button"
      type="button"
      active={active}
      variant="light"
      color="green"
      onClick={onSelect}
      leftSection={icon}
      rightSection={
        meta ? (
          <Text span size="xs" c="dimmed">
            {meta}
          </Text>
        ) : undefined
      }
      label={
        <span className="truncate">
          {label}
          {secondary && (
            <Text span inherit c="dimmed">
              {' '}
              {secondary}
            </Text>
          )}
        </span>
      }
      styles={{
        root: { borderRadius: 'var(--mantine-radius-sm)' },
        label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      }}
    />
  );

  const mutedIcon = (Icon: LucideIcon) => (
    <Icon size={16} style={{ color: 'var(--mantine-color-dimmed)' }} aria-hidden="true" />
  );

  const renderPanel = () => {
    const query = facetQuery.trim().toLowerCase();

    if (activeFacet === 'availability') {
      const rows = (facetsData?.availability ?? []).map(({ value, count }) =>
        renderRow(value, {
          icon: mutedIcon(CircleDot),
          label: t(`search.availability.${value}`),
          meta: `(${count})`,
          active: availabilityValue === value,
          onSelect: () => toggleFacet('availability', value),
        }),
      );
      return <div className="flex flex-col">{rows}</div>;
    }

    let rows: React.ReactNode[] = [];
    if (activeFacet === 'owner') {
      rows = (facetsData?.owners ?? [])
        .filter(
          o =>
            !query ||
            o.username.toLowerCase().includes(query) ||
            o.name.toLowerCase().includes(query),
        )
        .map(o =>
          renderRow(o.id, {
            icon: mutedIcon(User),
            label: o.name || o.username,
            meta: `(${o.count})`,
            active: ownerId === o.id,
            onSelect: () => toggleFacet('owner', o.id),
          }),
        );
    } else if (activeFacet === 'collection') {
      rows = (facetsData?.collections ?? [])
        .filter(c => !query || c.name.toLowerCase().includes(query))
        .map(c =>
          renderRow(c.id, {
            icon: mutedIcon(BookMarked),
            label: c.name,
            secondary: `(${c.owner})`,
            meta: `(${c.count})`,
            active: collectionId === c.id,
            onSelect: () => toggleFacet('collection', c.id),
          }),
        );
    } else {
      rows = (facetsData?.categories ?? [])
        .map(facet => {
          const label = t(categoryTranslationKeys[facet.category] ?? facet.category);
          return { facet, label };
        })
        .filter(({ label }) => !query || label.toLowerCase().includes(query))
        .map(({ facet, label }) =>
          renderRow(facet.category, {
            icon: mutedIcon(getCategoryIcon(facet.category)),
            label,
            meta: `(${facet.count})`,
            active: categoryValue === facet.category,
            onSelect: () => toggleFacet('category', facet.category),
          }),
        );
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
        {facetsQuery.isLoading ? (
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
