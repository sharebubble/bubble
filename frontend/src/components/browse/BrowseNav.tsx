import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useLanguage } from '@/contexts/LanguageContext';
import { ItemCategoryFilter } from '@/hooks/types';
import { cn } from '@/lib/utils';
import { ArrowDown, ArrowUp, Binoculars, Calendar, Store } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { ConditionFilter } from './ConditionFilter';
import { CategoryFilter } from './CategoryFilter';
import { ConditionEnum } from '@/services/django';

type SortField = 'name' | 'price' | 'date';
type SortDir = 'asc' | 'desc';

type BrowseNavProps = {
  selectedCategory: ItemCategoryFilter;
  selectedConditions: ConditionEnum[];
  onSelectedCategoryChange: (category: ItemCategoryFilter) => void;
  onSelectedConditionsChange: (conditions: ConditionEnum[]) => void;
  sortField: SortField;
  sortDir: SortDir;
  onSortClick: (field: SortField) => void;
  onlyAvailable: boolean;
  onOnlyAvailableChange: (value: boolean) => void;
  className?: string;
};

const browseTabs = [
  { label: 'browse.bookOrRent', type: 'rent', icon: Calendar },
  { label: 'browse.buy', type: 'buy', icon: Store },
  { label: 'browse.wanted', type: 'wanted', icon: Binoculars },
];

export const BrowseNav = ({
  selectedCategory,
  selectedConditions,
  onSelectedCategoryChange,
  onSelectedConditionsChange,
  sortField,
  sortDir,
  onSortClick,
  onlyAvailable,
  onOnlyAvailableChange,
  className,
}: BrowseNavProps) => {
  const { t } = useLanguage();
  const location = useLocation();

  const params = new URLSearchParams(location.search);
  const activeType = location.pathname === '/' ? params.get('type') : null;

  return (
    <form
      onSubmit={event => event.preventDefault()}
      className={cn(
        className,
        'flex w-full flex-wrap items-center justify-between gap-y-2 gap-x-4',
      )}
    >
      {/* Browse Tabs */}
      <div className="flex order-1">
        {browseTabs.map(tab => {
          const isActive = activeType === tab.type;
          const Icon = tab.icon;
          const tabParams = new URLSearchParams(location.search);
          tabParams.set('type', tab.type);
          tabParams.delete('page');
          const tabSearch = tabParams.toString();

          return (
            <NavLink
              key={tab.type}
              to={`/?${tabSearch}`}
              className={cn(
                buttonVariants({
                  variant: isActive ? 'default' : 'outline-primary',
                }),
                'flex-1 justify-center rounded-none',
                'first:rounded-l-md last:rounded-r-md not-first:-ml-px',
                isActive ? 'relative z-10 border border-primary shadow-glow' : 'hover:z-10',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">{t(tab.label)}</span>
            </NavLink>
          );
        })}
      </div>

      {/* Sort buttons — top-right on mobile, far-right on desktop */}
      <div className="flex shrink-0 items-center gap-1 rounded-lg border p-1 order-2 lg:order-3">
        {(['price', 'date'] as const).map(field => {
          const active = sortField === field;
          const label = t(
            `index.sort${field.charAt(0).toUpperCase() + field.slice(1)}` as
              | 'index.sortName'
              | 'index.sortPrice'
              | 'index.sortDate',
          );
          return (
            <Button
              key={field}
              variant={active ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onSortClick(field)}
              className="h-8 gap-1 px-2 text-xs"
            >
              {label}
              {active &&
                (sortDir === 'asc' ? (
                  <ArrowUp className="h-3 w-3" />
                ) : (
                  <ArrowDown className="h-3 w-3" />
                ))}
            </Button>
          );
        })}
      </div>

      {/* Detail filters — row below on mobile, between tabs and sort on desktop */}
      <div className="flex flex-row gap-2 order-3 w-full lg:order-2 lg:w-auto lg:flex-1">
        <CategoryFilter
          selectedCategory={selectedCategory}
          onCategoryChange={onSelectedCategoryChange}
        />
        {activeType === 'buy' && (
          <ConditionFilter
            selectedConditions={selectedConditions}
            onConditionsChange={onSelectedConditionsChange}
          />
        )}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-muted">
                <Checkbox
                  id="only-available"
                  checked={onlyAvailable}
                  onCheckedChange={checked => onOnlyAvailableChange(checked === true)}
                />
                <span>{t('index.onlyAvailable')}</span>
              </label>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{t('index.onlyAvailableTooltip')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </form>
  );
};
