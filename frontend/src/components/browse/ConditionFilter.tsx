import { useLanguage } from '@/contexts/LanguageContext';
import type { ConditionEnum } from '@/services/django/types.gen';
import { Button, Checkbox, Menu } from '@mantine/core';
import { ChevronDown } from 'lucide-react';

const CONDITIONS: ConditionEnum[] = [0, 1, 2];

interface ConditionFilterProps {
  selectedConditions: ConditionEnum[];
  onConditionsChange: (conditions: ConditionEnum[]) => void;
}

export const ConditionFilter = ({
  selectedConditions,
  onConditionsChange,
}: ConditionFilterProps) => {
  const { t } = useLanguage();

  const getConditionName = (value: ConditionEnum) => {
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

  const toggleCondition = (condition: ConditionEnum) => {
    const newConditions = selectedConditions.includes(condition)
      ? selectedConditions.filter(c => c !== condition)
      : [...selectedConditions, condition];
    onConditionsChange(newConditions);
  };

  const selectedConditionNames = CONDITIONS.filter(condition =>
    selectedConditions.includes(condition),
  ).map(getConditionName);

  const triggerLabel =
    selectedConditionNames.length > 0 ? selectedConditionNames.join(' / ') : t('index.condition');

  return (
    <Menu position="bottom-start" shadow="md" closeOnItemClick={false}>
      <Menu.Target>
        <Button
          variant="outline"
          justify="space-between"
          className="min-w-40"
          rightSection={<ChevronDown size={16} className="text-muted-foreground" />}
          aria-label={t('index.condition')}
        >
          <span className="truncate">{triggerLabel}</span>
        </Button>
      </Menu.Target>
      <Menu.Dropdown className="min-w-40">
        {CONDITIONS.map(condition => (
          <Menu.Item
            key={condition}
            closeMenuOnClick={false}
            onClick={() => toggleCondition(condition)}
            leftSection={
              <Checkbox
                checked={selectedConditions.includes(condition)}
                readOnly
                tabIndex={-1}
                variant="outline"
                aria-hidden="true"
              />
            }
          >
            {getConditionName(condition)}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
};
