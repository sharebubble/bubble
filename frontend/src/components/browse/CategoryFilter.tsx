import { useLanguage } from '@/contexts/LanguageContext';
import { type ItemCategoryFilter } from '@/hooks/types';
import { categories, categoryTranslationKeys, getCategoryIcon } from '@/lib/categoryIcons';
import { Group, Select } from '@mantine/core';

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
    <Select
      size="md"
      checkIconPosition="right"
      aria-label={t('editItem.category')}
      value={selectedCategory}
      data={categories.map(category => ({
        value: category.id,
        label: getCategoryName(category.id),
      }))}
      leftSection={<SelectedCategoryIcon className={categoryIconClassName} />}
      onChange={value => {
        if (value) onCategoryChange(value as ItemCategoryFilter);
      }}
      renderOption={({ option }) => {
        const Icon = getCategoryIcon(option.value);
        return (
          <Group gap="xs">
            <Icon className={categoryIconClassName} />
            <span>{option.label}</span>
          </Group>
        );
      }}
    />
  );
};
