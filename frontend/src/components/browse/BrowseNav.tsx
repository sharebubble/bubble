import {
  Checkbox,
  Flex,
  Group,
  Button as MantineButton,
  Menu,
  Radio,
  SegmentedControl,
} from '@mantine/core';
import { useLanguage } from '@/contexts/LanguageContext';
import { ItemCategoryFilter } from '@/hooks/types';
import { cn } from '@/lib/utils';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Binoculars,
  Calendar,
  ChevronDown,
  Filter,
  Store,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CategoryFilter } from './CategoryFilter';
import { ConditionEnum } from '@/services/django';

type SortField = 'name' | 'price' | 'date';
type SortDir = 'asc' | 'desc';
type Scope = 'local' | 'federated' | 'all';

type BrowseNavProps = {
  selectedCategory: ItemCategoryFilter;
  selectedConditions: ConditionEnum[];
  onSelectedCategoryChange: (category: ItemCategoryFilter) => void;
  onSelectedConditionsChange: (conditions: ConditionEnum[]) => void;
  sortField: SortField;
  sortDir: SortDir;
  onSortChange: (field: SortField, dir: SortDir) => void;
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  onlyAvailable: boolean;
  onOnlyAvailableChange: (value: boolean) => void;
  className?: string;
};

const browseTabs = [
  { label: 'browse.bookOrRent', type: 'rent', icon: Calendar },
  { label: 'browse.buy', type: 'buy', icon: Store },
  { label: 'browse.wanted', type: 'wanted', icon: Binoculars },
];

const CONDITIONS: ConditionEnum[] = [0, 1, 2];

type BrowseType = (typeof browseTabs)[number]['type'];

export const BrowseNav = ({
  selectedCategory,
  selectedConditions,
  onSelectedCategoryChange,
  onSelectedConditionsChange,
  sortField,
  sortDir,
  onSortChange,
  scope,
  onScopeChange,
  onlyAvailable,
  onOnlyAvailableChange,
  className,
}: BrowseNavProps) => {
  const { t } = useLanguage();
  const location = useLocation();

  const params = new URLSearchParams(location.search);
  const activeType = params.get('type') as BrowseType | null;
  const navigate = useNavigate();

  const handleTypeChange = (value: string): void => {
    const nextType = value as BrowseType;
    const nextParams = new URLSearchParams(location.search);
    nextParams.set('type', nextType);
    nextParams.delete('page');
    const nextSearch = nextParams.toString();
    navigate(`${location.pathname}?${nextSearch}`);
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
    <form
      onSubmit={event => event.preventDefault()}
      className={cn(className, 'flex w-full flex-col gap-2')}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        {/* Browse Tabs */}
        <SegmentedControl
          className="w-full md:flex-1"
          color="green"
          size="sm"
          value={activeType || undefined}
          onChange={handleTypeChange}
          data={[
            {
              value: 'rent',
              label: (
                <Flex
                  direction={{ base: 'column', sm: 'row' }}
                  align="center"
                  justify="center"
                  columnGap={8}
                  className="py-1"
                >
                  <Calendar size={16} />
                  <span>{t('browse.bookOrRent')}</span>
                </Flex>
              ),
            },
            {
              value: 'buy',
              label: (
                <Flex
                  direction={{ base: 'column', sm: 'row' }}
                  align="center"
                  justify="center"
                  columnGap={8}
                  className="py-1"
                >
                  <Store size={16} />
                  <span>{t('browse.buy')}</span>
                </Flex>
              ),
            },
            {
              value: 'wanted',
              label: (
                <Flex
                  direction={{ base: 'column', sm: 'row' }}
                  align="center"
                  justify="center"
                  columnGap={8}
                  className="py-1"
                >
                  <Binoculars size={16} />
                  <span>{t('browse.wanted')}</span>
                </Flex>
              ),
            },
          ]}
        />

        <Group className="w-full md:w-auto" wrap="nowrap">
          <div className="min-w-0 grow">
            <CategoryFilter
              selectedCategory={selectedCategory}
              onCategoryChange={onSelectedCategoryChange}
            />
          </div>

          <Menu position="bottom-end" shadow="md" width={320} closeOnItemClick={false}>
            <Menu.Target>
              <MantineButton
                type="button"
                size="md"
                variant="default"
                className="shrink-0"
                leftSection={<Filter className="h-3.5 w-3.5" aria-hidden="true" />}
                rightSection={<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
                aria-label={t('index.filterAndSort')}
                title={t('index.filterAndSort')}
              ></MantineButton>
            </Menu.Target>

            <Menu.Dropdown>
              <Menu.Label>{t('index.availability')}</Menu.Label>
              <Menu.Item
                leftSection={
                  <Checkbox
                    checked={onlyAvailable}
                    readOnly
                    tabIndex={-1}
                    variant="outline"
                    aria-hidden="true"
                  />
                }
                onClick={() => onOnlyAvailableChange(!onlyAvailable)}
              >
                {t('index.onlyAvailable')}
              </Menu.Item>
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
              <>
                <Menu.Label>{t('index.sort')}</Menu.Label>
                <Menu.Item onClick={handleDateSortClick} leftSection={dateSortIconColored}>
                  {t('index.sortDate')}
                </Menu.Item>
                <Menu.Item onClick={handlePriceSortClick} leftSection={priceSortIconColored}>
                  {t('index.sortPrice')}
                </Menu.Item>
              </>
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
        </Group>
      </div>
    </form>
  );
};
