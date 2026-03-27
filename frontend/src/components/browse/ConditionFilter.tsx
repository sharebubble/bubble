import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLanguage } from '@/contexts/LanguageContext';
import type { ConditionEnum } from '@/services/django/types.gen';
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="min-w-40 justify-between"
          aria-label={t('index.condition')}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        {CONDITIONS.map(condition => (
          <DropdownMenuCheckboxItem
            key={condition}
            checked={selectedConditions.includes(condition)}
            onCheckedChange={() => toggleCondition(condition)}
            onSelect={event => event.preventDefault()}
          >
            {getConditionName(condition)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
