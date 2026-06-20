import { Checkbox, Button as MantineButton, Menu, Radio } from '@mantine/core';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Filter } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ConditionEnum } from '@/services/django';

type SortField = 'name' | 'price' | 'date';
type SortDir = 'asc' | 'desc';
type Scope = 'local' | 'federated' | 'all';

type BrowseNavProps = {
  selectedConditions: ConditionEnum[];
  onSelectedConditionsChange: (conditions: ConditionEnum[]) => void;
  sortField: SortField;
  sortDir: SortDir;
  onSortChange: (field: SortField, dir: SortDir) => void;
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  className?: string;
};

// Item "type" presets. Each maps to a set of sales types on the browse page.
const browseTypes = [
  { label: 'browse.rent', type: 'rent' },
  { label: 'browse.buy', type: 'buy' },
  { label: 'browse.wanted', type: 'wanted' },
] as const;

const CONDITIONS: ConditionEnum[] = [0, 1, 2];

type BrowseType = (typeof browseTypes)[number]['type'];

export const BrowseNav = ({
  selectedConditions,
  onSelectedConditionsChange,
  sortField,
  sortDir,
  onSortChange,
  scope,
  onScopeChange,
  className,
}: BrowseNavProps) => {
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();

  const params = new URLSearchParams(location.search);
  const activeType = params.get('type') as BrowseType | null;

  // Toggle the active type: re-selecting it clears the filter (shows all types).
  const handleTypeChange = (value: BrowseType): void => {
    const nextParams = new URLSearchParams(location.search);
    if (activeType === value) nextParams.delete('type');
    else nextParams.set('type', value);
    nextParams.delete('page');
    const nextSearch = nextParams.toString();
    navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ''}`);
  };

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
    onSelectedConditionsChange(nextConditions);
  };

  const handleDateSortClick = (): void => {
    if (sortField === 'date') {
      onSortChange('date', sortDir === 'desc' ? 'asc' : 'desc');
      return;
    }

    onSortChange('date', 'desc');
  };

  const handlePriceSortClick = (): void => {
    if (sortField === 'price') {
      onSortChange('price', sortDir === 'asc' ? 'desc' : 'asc');
      return;
    }

    onSortChange('price', 'asc');
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
    <Menu position="bottom-end" shadow="md" width={320} closeOnItemClick={false}>
      <Menu.Target>
        <MantineButton
          type="button"
          size="sm"
          variant="default"
          className={cn('shrink-0', className)}
          leftSection={<Filter className="h-3.5 w-3.5" aria-hidden="true" />}
          rightSection={<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
          aria-label={t('index.filterAndSort')}
          title={t('index.filterAndSort')}
        ></MantineButton>
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Label>{t('index.type')}</Menu.Label>
        {browseTypes.map(({ label, type }) => (
          <Menu.Item
            key={type}
            leftSection={
              <Radio
                checked={activeType === type}
                readOnly
                tabIndex={-1}
                aria-hidden="true"
                variant="outline"
              />
            }
            onClick={() => handleTypeChange(type)}
          >
            {t(label)}
          </Menu.Item>
        ))}
        <Menu.Divider />

        {activeType === 'buy' && (
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
          onClick={() => onScopeChange('local')}
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
          onClick={() => onScopeChange('all')}
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
          onClick={() => onScopeChange('federated')}
        >
          {t('index.scopeFederated')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
};
