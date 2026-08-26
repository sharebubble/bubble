import {
  Button as MantineButton,
  Checkbox,
  Group,
  Menu,
  Radio,
  SegmentedControl,
  Text,
} from '@mantine/core';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { useBrowseParams } from '@/hooks/useBrowseParams';
import { ArrowDown, ArrowUp, ArrowUpDown, Grid3X3, List, Sparkles } from 'lucide-react';
import { ConditionEnum } from '@/services/django';

type BrowseNavProps = {
  totalCount: number;
  className?: string;
};

const CONDITIONS: ConditionEnum[] = [0, 1, 2];

export const BrowseNav = ({ totalCount, className }: BrowseNavProps) => {
  const { t } = useLanguage();

  const {
    typeParam,
    searchQuery,
    selectedConditions,
    sortField,
    sortDir,
    scope,
    viewMode,
    setConditions,
    setSort,
    setScope,
    setViewMode,
  } = useBrowseParams();
  const getConditionName = (value: ConditionEnum): string => {
    switch (value) {
      case 0:
        return t('condition.new');
      case 1:
        return t('condition.used');
      case 2:
        return t('condition.broken');
      default:
        return t('condition.unknown');
    }
  };

  const toggleCondition = (condition: ConditionEnum): void => {
    const nextConditions = selectedConditions.includes(condition)
      ? selectedConditions.filter(value => value !== condition)
      : [...selectedConditions, condition];
    setConditions(nextConditions);
  };

  // Relevance has a single meaningful direction (best match first), so it is
  // not a toggle like the other two.
  const handleRelevanceSortClick = (): void => setSort('relevance', 'desc');

  const handleDateSortClick = (): void => {
    if (sortField === 'date') {
      setSort('date', sortDir === 'desc' ? 'asc' : 'desc');
      return;
    }
    setSort('date', 'desc');
  };

  const handlePriceSortClick = (): void => {
    if (sortField === 'price') {
      setSort('price', sortDir === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSort('price', 'asc');
  };

  const activeSortIconClass = 'h-3.5 w-3.5 text-[var(--mantine-color-green-6)]';
  const inactiveSortIconClass = 'h-3.5 w-3.5 text-muted-foreground';

  const dateSortIconColored =
    sortField !== 'date' ? (
      <ArrowUpDown className={inactiveSortIconClass} aria-hidden="true" />
    ) : sortDir === 'asc' ? (
      <ArrowUp className={activeSortIconClass} aria-hidden="true" />
    ) : (
      <ArrowDown className={activeSortIconClass} aria-hidden="true" />
    );

  const priceSortIconColored =
    sortField !== 'price' ? (
      <ArrowUpDown className={inactiveSortIconClass} aria-hidden="true" />
    ) : sortDir === 'desc' ? (
      <ArrowDown className={activeSortIconClass} aria-hidden="true" />
    ) : (
      <ArrowUp className={activeSortIconClass} aria-hidden="true" />
    );

  return (
    <Group justify="space-between" align="center">
      <Text size="sm" c="dimmed">
        {t('index.itemsFound').replace('{count}', String(totalCount))}
      </Text>
      <Group gap="xs" wrap="nowrap">
        <SegmentedControl
          value={viewMode}
          onChange={value => setViewMode(value as 'list' | 'cards')}
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
        <Menu position="bottom-end" shadow="md" width={320} closeOnItemClick={false}>
          <Menu.Target>
            <MantineButton
              type="button"
              size="compact-sm"
              variant="default"
              className={cn('shrink-0', className)}
              leftSection={
                sortField === 'relevance' ? (
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                ) : sortDir === 'asc' ? (
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                )
              }
              aria-label={t('index.filterAndSort')}
              title={t('index.filterAndSort')}
            >
              {sortField === 'relevance'
                ? t('index.sortRelevance')
                : sortField === 'price'
                  ? t('index.sortPrice')
                  : t('index.sortDate')}
            </MantineButton>
          </Menu.Target>

          <Menu.Dropdown>
            {typeParam === 'buy' && (
              <>
                <Menu.Label>{t('index.condition')}</Menu.Label>
                {CONDITIONS.map(condition => (
                  <Menu.Item
                    key={condition}
                    closeMenuOnClick={false}
                    onClick={() => toggleCondition(condition)}
                    leftSection={
                      <Checkbox
                        checked={selectedConditions.includes(condition)}
                        readOnly
                        variant="outline"
                        tabIndex={-1}
                        aria-hidden="true"
                      />
                    }
                  >
                    {getConditionName(condition)}
                  </Menu.Item>
                ))}
                <Menu.Divider />
              </>
            )}

            {/* Sort control */}
            <Menu.Label>{t('index.sort')}</Menu.Label>
            {!!searchQuery && (
              <Menu.Item
                onClick={handleRelevanceSortClick}
                leftSection={
                  <Sparkles
                    className={
                      sortField === 'relevance' ? activeSortIconClass : inactiveSortIconClass
                    }
                    aria-hidden="true"
                  />
                }
              >
                {t('index.sortRelevance')}
              </Menu.Item>
            )}
            <Menu.Item onClick={handleDateSortClick} leftSection={dateSortIconColored}>
              {t('index.sortDate')}
            </Menu.Item>
            <Menu.Item onClick={handlePriceSortClick} leftSection={priceSortIconColored}>
              {t('index.sortPrice')}
            </Menu.Item>
            <Menu.Divider />

            <Menu.Label>{t('index.scope')}</Menu.Label>
            <Menu.Item
              leftSection={
                <Radio
                  checked={scope === 'local'}
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                  variant="outline"
                />
              }
              onClick={() => setScope('local')}
            >
              {t('index.scopeLocal')}
            </Menu.Item>
            <Menu.Item
              leftSection={
                <Radio
                  checked={scope === 'all'}
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                  variant="outline"
                />
              }
              onClick={() => setScope('all')}
            >
              {t('index.scopeAll')}
            </Menu.Item>
            <Menu.Item
              leftSection={
                <Radio
                  checked={scope === 'federated'}
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                  variant="outline"
                />
              }
              onClick={() => setScope('federated')}
            >
              {t('index.scopeFederated')}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Group>
  );
};
