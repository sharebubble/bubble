import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { FieldStates } from '@/hooks/useFieldAutoSave';
import { cn } from '@/lib/utils';
import {
  CategoryEnum,
  ConditionEnum,
  RentalPeriodEnum,
  SalesTypeEnum,
  Status402Enum,
  VisibilityEnum,
} from '@/services/django';
import { Check, Loader2 } from 'lucide-react';

type FieldWrapperProps = {
  fieldName: string;
  fieldStates?: FieldStates;
  children: React.ReactNode;
  className?: string;
};

const FieldWrapper = ({ fieldName, fieldStates, children, className }: FieldWrapperProps) => {
  const state = fieldStates?.[fieldName];

  return (
    <div className={cn('relative', className)}>
      {children}
      {state?.status === 'saving' && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
      {state?.status === 'success' && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          <Check className="h-4 w-4 text-green-600" />
        </div>
      )}
      {state?.status === 'error' && state.errorMessage && (
        <p className="text-xs text-red-600 mt-1">{state.errorMessage}</p>
      )}
    </div>
  );
};

const getFieldBorderClass = (fieldName: string, fieldStates?: FieldStates) => {
  const state = fieldStates?.[fieldName];
  if (state?.status === 'success') return 'border-green-500 focus-visible:ring-green-500';
  if (state?.status === 'error') return 'border-red-500 focus-visible:ring-red-500';
  return '';
};

interface BasicFieldsProps {
  formData: {
    name: string;
    description: string;
  };
  setFormData: (data: any) => void;
  disabled?: boolean;
  descriptionRef?: React.RefObject<HTMLTextAreaElement | null>;
  fieldStates?: FieldStates;
  onFieldBlur?: (fieldName: string, value: unknown) => void;
}

export const BasicFields = ({
  formData,
  setFormData,
  disabled,
  descriptionRef,
  fieldStates,
  onFieldBlur,
}: BasicFieldsProps) => {
  const { t } = useLanguage();

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="name">{t('editItem.name')} *</Label>
        <FieldWrapper fieldName="name" fieldStates={fieldStates}>
          <Input
            id="name"
            type="text"
            placeholder={t('editItem.enterName')}
            value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
            onBlur={() => onFieldBlur?.('name', formData.name)}
            disabled={disabled}
            required
            className={cn(getFieldBorderClass('name', fieldStates), 'pr-8')}
          />
        </FieldWrapper>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">{t('editItem.description')}</Label>
        <FieldWrapper fieldName="description" fieldStates={fieldStates}>
          <Textarea
            id="description"
            ref={descriptionRef}
            placeholder={t('editItem.enterDescription')}
            value={formData.description}
            onChange={e => setFormData({ ...formData, description: e.target.value })}
            onBlur={() => onFieldBlur?.('description', formData.description)}
            disabled={disabled}
            className={cn('min-h-[100px] pr-8', getFieldBorderClass('description', fieldStates))}
          />
        </FieldWrapper>
      </div>
    </>
  );
};

interface CategoryConditionFieldsProps {
  formData: {
    category: CategoryEnum | '';
    condition: ConditionEnum | '';
  };
  setFormData: (data: any) => void;
  disabled?: boolean;
  categories: CategoryEnum[];
  onCategoryChange?: (category: CategoryEnum) => void;
  fieldStates?: FieldStates;
  onFieldChange?: (fieldName: string, value: unknown) => void;
}

export const CategoryConditionFields = ({
  formData,
  setFormData,
  disabled,
  categories,
  onCategoryChange,
  fieldStates,
  onFieldChange,
}: CategoryConditionFieldsProps) => {
  const { t } = useLanguage();

  const conditions = [
    { value: 0, key: 'new' },
    { value: 1, key: 'used' },
    { value: 2, key: 'broken' },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label htmlFor="category">{t('editItem.category')} *</Label>
        <FieldWrapper fieldName="category" fieldStates={fieldStates}>
          <Select
            key={formData.category || 'empty'}
            value={formData.category}
            onValueChange={(value: CategoryEnum) => {
              if (value) {
                setFormData({ ...formData, category: value });
                onCategoryChange?.(value);
                onFieldChange?.('category', value);
              }
            }}
            disabled={disabled}
            required
          >
            <SelectTrigger className={cn(getFieldBorderClass('category', fieldStates), 'pr-8')}>
              <SelectValue placeholder={t('editItem.selectCategory')} />
            </SelectTrigger>
            <SelectContent>
              {categories.map(category => (
                <SelectItem key={category} value={category}>
                  {t(`categories.${category}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldWrapper>
      </div>

      <div className="space-y-2">
        <Label htmlFor="condition">{t('editItem.condition')} *</Label>
        <FieldWrapper fieldName="condition" fieldStates={fieldStates}>
          <Select
            key={formData.condition.toString()}
            value={formData.condition.toString()}
            onValueChange={value => {
              if (value) {
                const conditionValue = parseInt(value) as ConditionEnum;
                setFormData({
                  ...formData,
                  condition: conditionValue,
                });
                onFieldChange?.('condition', conditionValue);
              }
            }}
            disabled={disabled}
            required
          >
            <SelectTrigger className={cn(getFieldBorderClass('condition', fieldStates), 'pr-8')}>
              <SelectValue placeholder={t('editItem.selectCondition')} />
            </SelectTrigger>
            <SelectContent>
              {conditions.map(condition => (
                <SelectItem key={condition.value} value={condition.value.toString()}>
                  {t(`condition.${condition.key}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldWrapper>
      </div>
    </div>
  );
};

interface PricingFieldsProps {
  formData: {
    sales_type: SalesTypeEnum | '';
    price: string;
    rental_period: RentalPeriodEnum | '';
    rental_self_service: boolean;
    rental_open_end: boolean;
  };
  setFormData: (data: any) => void;
  disabled?: boolean;
  fieldStates?: FieldStates;
  onFieldBlur?: (fieldName: string, value: unknown) => void;
  onFieldChange?: (fieldName: string, value: unknown) => void;
}

const SALES_TYPE_OPTIONS: { value: SalesTypeEnum; labelKey: string }[] = [
  { value: 'sell', labelKey: 'item.salesType.sell' },
  { value: 'donate', labelKey: 'item.salesType.donate' },
  { value: 'rent', labelKey: 'item.salesType.rent' },
  { value: 'borrow', labelKey: 'item.salesType.borrow' },
  { value: 'want_buy', labelKey: 'item.salesType.want_buy' },
  { value: 'want_rent', labelKey: 'item.salesType.want_rent' },
];

/** Types that require a price > 0 */
const PRICE_REQUIRED_TYPES: SalesTypeEnum[] = ['sell', 'rent'];
/** Types where price must be null (hidden) */
const PRICE_NULL_TYPES: SalesTypeEnum[] = ['donate', 'borrow'];

export const PricingFields = ({
  formData,
  setFormData,
  disabled,
  fieldStates,
  onFieldBlur,
  onFieldChange,
}: PricingFieldsProps) => {
  const { t } = useLanguage();

  const salesType = formData.sales_type as SalesTypeEnum | '';
  const showPrice = salesType !== '' && !PRICE_NULL_TYPES.includes(salesType as SalesTypeEnum);
  const showRentalOptions = salesType === 'rent' || salesType === 'borrow';

  const handleSalesTypeChange = (value: SalesTypeEnum) => {
    const updates: any = { ...formData, sales_type: value };

    // Clear price locally for types that must have null price
    // (backend also auto-clears price when sales_type changes to donate/borrow)
    if (PRICE_NULL_TYPES.includes(value)) {
      updates.price = '';
    }
    // Clear rental options when switching away from rent/borrow
    if (value !== 'rent' && value !== 'borrow') {
      updates.rental_period = '';
      updates.rental_self_service = false;
      updates.rental_open_end = false;
    }
    setFormData(updates);
    onFieldChange?.('sales_type', value);
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="sales_type">{t('item.salesType.label')} *</Label>
          <FieldWrapper fieldName="sales_type" fieldStates={fieldStates}>
            <Select
              key={salesType || 'empty'}
              value={salesType}
              onValueChange={handleSalesTypeChange}
              disabled={disabled}
              required
            >
              <SelectTrigger className={cn(getFieldBorderClass('sales_type', fieldStates), 'pr-8')}>
                <SelectValue placeholder={t('item.salesType.label')} />
              </SelectTrigger>
              <SelectContent>
                {SALES_TYPE_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {t(opt.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldWrapper>
        </div>

        {showPrice && (
          <div className="space-y-2">
            <Label htmlFor="price">
              {salesType === 'rent' ? t('editItem.rentalPrice') : t('editItem.price')}
              {PRICE_REQUIRED_TYPES.includes(salesType as SalesTypeEnum) ? ' *' : ''}
            </Label>
            <FieldWrapper fieldName="price" fieldStates={fieldStates}>
              <Input
                id="price"
                type="number"
                step="1.00"
                placeholder={t('editItem.enterPrice')}
                value={formData.price}
                onChange={e => setFormData({ ...formData, price: e.target.value })}
                onBlur={() => onFieldBlur?.('price', formData.price === '' ? null : formData.price)}
                disabled={disabled}
                required={PRICE_REQUIRED_TYPES.includes(salesType as SalesTypeEnum)}
                className={cn(getFieldBorderClass('price', fieldStates), 'pr-8')}
              />
            </FieldWrapper>
          </div>
        )}
      </div>

      {showRentalOptions && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="rental_period">{t('editItem.rentalPeriod')}</Label>
              <FieldWrapper fieldName="rental_period" fieldStates={fieldStates}>
                <Select
                  value={formData.rental_period}
                  onValueChange={(value: RentalPeriodEnum) => {
                    setFormData({ ...formData, rental_period: value });
                    onFieldChange?.('rental_period', value);
                  }}
                  disabled={disabled}
                  required
                >
                  <SelectTrigger
                    className={cn(getFieldBorderClass('rental_period', fieldStates), 'pr-8')}
                  >
                    <SelectValue placeholder={t('editItem.selectRentalPeriod')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="h">{t('rentalPeriod.h')}</SelectItem>
                    <SelectItem value="d">{t('rentalPeriod.d')}</SelectItem>
                    <SelectItem value="w">{t('rentalPeriod.w')}</SelectItem>
                  </SelectContent>
                </Select>
              </FieldWrapper>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">{t('editItem.rentalOptions')}</Label>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.rental_self_service}
                    onChange={e => {
                      setFormData({
                        ...formData,
                        rental_self_service: e.target.checked,
                      });
                      onFieldChange?.('rental_self_service', e.target.checked);
                    }}
                    disabled={disabled}
                  />
                  <span className="text-sm">{t('editItem.rentalSelfService')}</span>
                </label>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.rental_open_end}
                    onChange={e => {
                      setFormData({
                        ...formData,
                        rental_open_end: e.target.checked,
                      });
                      onFieldChange?.('rental_open_end', e.target.checked);
                    }}
                    disabled={disabled}
                  />
                  <span className="text-sm">{t('editItem.rentalOpenEnd')}</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

interface StatusFieldProps {
  formData: {
    status: Status402Enum | '';
  };
  setFormData: (data: any) => void;
  disabled?: boolean;
  fieldStates?: FieldStates;
  onFieldChange?: (fieldName: string, value: unknown) => void;
}

export const StatusField = ({
  formData,
  setFormData,
  disabled,
  fieldStates,
  onFieldChange,
}: StatusFieldProps) => {
  const { t } = useLanguage();

  const statuses = [
    { value: 0, label: 'draft' },
    { value: 1, label: 'processing' },
    { value: 2, label: 'available' },
    { value: 3, label: 'reserved' },
    { value: 4, label: 'rented' },
    { value: 5, label: 'sold' },
  ];

  return (
    <div className="flex-1 max-w-xs space-y-2">
      <Label htmlFor="status" className="text-sm">
        {t('editItem.status')}
      </Label>
      <FieldWrapper fieldName="status" fieldStates={fieldStates}>
        <Select
          key={formData.status.toString()}
          value={formData.status.toString()}
          onValueChange={value => {
            if (value !== '') {
              const statusValue = parseInt(value) as Status402Enum;
              setFormData({
                ...formData,
                status: statusValue,
              });
              onFieldChange?.('status', statusValue);
            }
          }}
          disabled={disabled}
        >
          <SelectTrigger className={cn(getFieldBorderClass('status', fieldStates), 'pr-8')}>
            <SelectValue placeholder={t('editItem.selectStatus')} />
          </SelectTrigger>
          <SelectContent>
            {statuses.map(status => (
              <SelectItem key={status.value} value={status.value.toString()}>
                {t(`status.${status.label.toLowerCase()}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldWrapper>
    </div>
  );
};

interface VisibilityFieldProps {
  formData: {
    visibility: VisibilityEnum | '';
  };
  setFormData: (data: any) => void;
  disabled?: boolean;
  fieldStates?: FieldStates;
  onFieldChange?: (fieldName: string, value: unknown) => void;
}

export const VisibilityField = ({
  formData,
  setFormData,
  disabled,
  fieldStates,
  onFieldChange,
}: VisibilityFieldProps) => {
  const { t } = useLanguage();

  const visibilities: { value: VisibilityEnum; label: string }[] = [
    { value: 0, label: 'public' },
    { value: 1, label: 'authenticated' },
    { value: 2, label: 'specific' },
    { value: 3, label: 'private' },
  ];

  return (
    <div className="flex-1 max-w-xs space-y-2">
      <Label htmlFor="visibility" className="text-sm">
        {t('editItem.visibility')}
      </Label>
      <FieldWrapper fieldName="visibility" fieldStates={fieldStates}>
        <Select
          key={formData.visibility !== '' ? formData.visibility.toString() : 'empty'}
          value={formData.visibility !== '' ? formData.visibility.toString() : ''}
          onValueChange={value => {
            if (value !== '') {
              const visibilityValue = parseInt(value) as VisibilityEnum;
              setFormData({
                ...formData,
                visibility: visibilityValue,
              });
              onFieldChange?.('visibility', visibilityValue);
            }
          }}
          disabled={disabled}
        >
          <SelectTrigger className={cn(getFieldBorderClass('visibility', fieldStates), 'pr-8')}>
            <SelectValue placeholder={t('editItem.selectVisibility')} />
          </SelectTrigger>
          <SelectContent>
            {visibilities.map(v => (
              <SelectItem key={v.value} value={v.value.toString()}>
                {t(`visibility.${v.label}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldWrapper>
    </div>
  );
};
