import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';
import { type ItemCategoryFilter } from '@/hooks/types';
import { categories, categoryTranslationKeys } from '@/lib/categoryIcons';

const categoryIconClassName = 'h-4 w-4 text-muted-foreground';

interface CategoryFilterProps {
  selectedCategory: ItemCategoryFilter;
  onCategoryChange: (category: ItemCategoryFilter) => void;
}

export const CategoryFilter = ({ selectedCategory, onCategoryChange }: CategoryFilterProps) => {
  const { t } = useLanguage();

  const selectedCategoryConfig =
    categories.find(category => category.id === selectedCategory) ?? categories[0];
  const SelectedCategoryIcon = selectedCategoryConfig.icon;

  const getCategoryName = (id: ItemCategoryFilter) => t(categoryTranslationKeys[id]);

  return (
    <div>
      <label htmlFor="category-filter" className="sr-only">
        {t('editItem.category')}
      </label>
      <Select
        value={selectedCategory}
        onValueChange={value => onCategoryChange(value as ItemCategoryFilter)}
      >
        <SelectTrigger id="category-filter">
          <div className="flex items-center gap-2">
            <SelectedCategoryIcon className={categoryIconClassName} />
            <span>{getCategoryName(selectedCategory)}</span>
          </div>
        </SelectTrigger>
        <SelectContent>
          {categories.map(category => {
            const Icon = category.icon;

            return (
              <SelectItem key={category.id} value={category.id}>
                <span className="flex items-center gap-2">
                  <Icon className={categoryIconClassName} />
                  <span>{getCategoryName(category.id)}</span>
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
};
