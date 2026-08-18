import { useLanguage } from '@/contexts/LanguageContext';
import { useCoinConfig } from '@/hooks/useAppConfig';
import { FieldStates } from '@/hooks/useFieldAutoSave';
import { useLocations } from '@/hooks/useLocations';
import type { PriceUnit } from '@/lib/coins';
import {
  CategoryEnum,
  ConditionEnum,
  RentalPeriodEnum,
  SalesTypeEnum,
  Status7D3Enum,
  VisibilityEnum,
} from '@/services/django';
import {
  Checkbox,
  NumberInput,
  Select,
  SegmentedControl,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { Check, Loader2 } from 'lucide-react';

/** Right-section indicator for the field auto-save state (spinner while saving, check on success). */
const getFieldRightSection = (fieldName: string, fieldStates?: FieldStates) => {
  const state = fieldStates?.[fieldName];
  if (state?.status === 'saving') {
    return <Loader2 size={16} className="animate-spin" color="var(--mantine-color-dimmed)" />;
  }
  if (state?.status === 'success') {
    return <Check size={16} color="var(--mantine-color-green-6)" />;
  }
  return undefined;
};

/** Error prop for the field auto-save state (message if present, red border otherwise). */
const getFieldError = (fieldName: string, fieldStates?: FieldStates) => {
  const state = fieldStates?.[fieldName];
  if (state?.status === 'error') return state.errorMessage || true;
  return undefined;
};

/** Green border on successful auto-save. */
const getFieldStyles = (fieldName: string, fieldStates?: FieldStates) =>
  fieldStates?.[fieldName]?.status === 'success'
    ? { input: { borderColor: 'var(--mantine-color-green-6)' } }
    : undefined;

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
      <TextInput
        id="name"
        label={t('editItem.name')}
        placeholder={t('editItem.enterName')}
        value={formData.name}
        onChange={e => setFormData({ ...formData, name: e.target.value })}
        onBlur={() => onFieldBlur?.('name', formData.name)}
        disabled={disabled}
        required
        rightSection={getFieldRightSection('name', fieldStates)}
        error={getFieldError('name', fieldStates)}
        styles={getFieldStyles('name', fieldStates)}
      />

      <Textarea
        id="description"
        ref={descriptionRef}
        label={t('editItem.description')}
        placeholder={t('editItem.enterDescription')}
        value={formData.description}
        onChange={e => setFormData({ ...formData, description: e.target.value })}
        onBlur={() => onFieldBlur?.('description', formData.description)}
        disabled={disabled}
        rightSection={getFieldRightSection('description', fieldStates)}
        error={getFieldError('description', fieldStates)}
        styles={{
          input: {
            minHeight: 100,
            ...(fieldStates?.description?.status === 'success'
              ? { borderColor: 'var(--mantine-color-green-6)' }
              : {}),
          },
        }}
      />
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
      <Select
        id="category"
        label={t('editItem.category')}
        placeholder={t('editItem.selectCategory')}
        value={formData.category || null}
        onChange={value => {
          if (value) {
            setFormData({ ...formData, category: value });
            onCategoryChange?.(value as CategoryEnum);
            onFieldChange?.('category', value);
          }
        }}
        data={categories.map(category => ({
          value: category,
          label: t(`categories.${category}`),
        }))}
        disabled={disabled}
        required
        allowDeselect={false}
        rightSection={getFieldRightSection('category', fieldStates)}
        error={getFieldError('category', fieldStates)}
        styles={getFieldStyles('category', fieldStates)}
      />

      <Select
        id="condition"
        label={t('editItem.condition')}
        placeholder={t('editItem.selectCondition')}
        value={formData.condition === '' ? null : String(formData.condition)}
        onChange={value => {
          if (value !== null) {
            const conditionValue = Number(value) as ConditionEnum;
            setFormData({
              ...formData,
              condition: conditionValue,
            });
            onFieldChange?.('condition', conditionValue);
          }
        }}
        data={conditions.map(condition => ({
          value: String(condition.value),
          label: t(`condition.${condition.key}`),
        }))}
        disabled={disabled}
        required
        allowDeselect={false}
        rightSection={getFieldRightSection('condition', fieldStates)}
        error={getFieldError('condition', fieldStates)}
        styles={getFieldStyles('condition', fieldStates)}
      />
    </div>
  );
};

interface PricingFieldsProps {
  formData: {
    sales_type: SalesTypeEnum | '';
    price: string;
    price_unit: PriceUnit | '';
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
  const coin = useCoinConfig();

  const salesType = formData.sales_type as SalesTypeEnum | '';
  const showPrice = salesType !== '' && !PRICE_NULL_TYPES.includes(salesType as SalesTypeEnum);
  const showRentalOptions = salesType === 'rent' || salesType === 'borrow';

  const handleSalesTypeChange = (value: SalesTypeEnum) => {
    const updates: any = { ...formData, sales_type: value };

    // Clear price locally for types that must have null price
    // (backend also auto-clears price — and resets price_unit to money —
    // when sales_type changes to donate/borrow)
    if (PRICE_NULL_TYPES.includes(value)) {
      updates.price = '';
      updates.price_unit = 'money';
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
        <Select
          id="sales_type"
          label={t('item.salesType.label')}
          placeholder={t('item.salesType.label')}
          value={salesType || null}
          onChange={value => {
            if (value) {
              handleSalesTypeChange(value as SalesTypeEnum);
            }
          }}
          data={SALES_TYPE_OPTIONS.map(opt => ({
            value: opt.value,
            label: t(opt.labelKey),
          }))}
          disabled={disabled}
          required
          allowDeselect={false}
          rightSection={getFieldRightSection('sales_type', fieldStates)}
          error={getFieldError('sales_type', fieldStates)}
          styles={getFieldStyles('sales_type', fieldStates)}
        />

        {showPrice && (
          <div className="space-y-2">
            <NumberInput
              id="price"
              label={salesType === 'rent' ? t('editItem.rentalPrice') : t('editItem.price')}
              placeholder={t('editItem.enterPrice')}
              value={formData.price}
              onChange={value =>
                setFormData({ ...formData, price: value === '' ? '' : String(value) })
              }
              onBlur={() => onFieldBlur?.('price', formData.price === '' ? null : formData.price)}
              disabled={disabled}
              required={PRICE_REQUIRED_TYPES.includes(salesType as SalesTypeEnum)}
              step={1}
              rightSection={getFieldRightSection('price', fieldStates)}
              error={getFieldError('price', fieldStates)}
              styles={getFieldStyles('price', fieldStates)}
            />

            <SegmentedControl
              id="price_unit"
              size="xs"
              fullWidth
              value={formData.price_unit || 'money'}
              onChange={value => {
                setFormData({ ...formData, price_unit: value as PriceUnit });
                onFieldChange?.('price_unit', value);
              }}
              data={[
                { value: 'money', label: t('editItem.priceUnitMoney') },
                { value: 'coin', label: coin.shortName },
              ]}
              disabled={disabled}
            />
          </div>
        )}
      </div>

      {showRentalOptions && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              id="rental_period"
              label={t('editItem.rentalPeriod')}
              placeholder={t('editItem.selectRentalPeriod')}
              value={formData.rental_period || null}
              onChange={value => {
                if (value) {
                  setFormData({ ...formData, rental_period: value });
                  onFieldChange?.('rental_period', value);
                }
              }}
              data={[
                { value: 'h', label: t('rentalPeriod.h') },
                { value: 'd', label: t('rentalPeriod.d') },
                { value: 'w', label: t('rentalPeriod.w') },
              ]}
              disabled={disabled}
              required
              allowDeselect={false}
              rightSection={getFieldRightSection('rental_period', fieldStates)}
              error={getFieldError('rental_period', fieldStates)}
              styles={getFieldStyles('rental_period', fieldStates)}
            />

            <div className="space-y-2">
              <Text size="sm" fw={500}>
                {t('editItem.rentalOptions')}
              </Text>
              <div className="flex flex-col gap-2">
                <Checkbox
                  label={t('editItem.rentalSelfService')}
                  checked={formData.rental_self_service}
                  onChange={e => {
                    const checked = e.currentTarget.checked;
                    setFormData({
                      ...formData,
                      rental_self_service: checked,
                    });
                    onFieldChange?.('rental_self_service', checked);
                  }}
                  disabled={disabled}
                />

                <Checkbox
                  label={t('editItem.rentalOpenEnd')}
                  checked={formData.rental_open_end}
                  onChange={e => {
                    const checked = e.currentTarget.checked;
                    setFormData({
                      ...formData,
                      rental_open_end: checked,
                    });
                    onFieldChange?.('rental_open_end', checked);
                  }}
                  disabled={disabled}
                />
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
    status: Status7D3Enum | '';
    sales_type?: SalesTypeEnum | '';
  };
  setFormData: (data: any) => void;
  disabled?: boolean;
  fieldStates?: FieldStates;
  onFieldChange?: (fieldName: string, value: unknown) => void;
}

const SELL_DONATE_STATUSES: { value: Status7D3Enum; label: string }[] = [
  { value: 0, label: 'draft' },
  { value: 2, label: 'available' },
  { value: 3, label: 'reserved' },
  { value: 5, label: 'sold' },
  { value: 6, label: 'archived' },
];

const RENT_BORROW_STATUSES: { value: Status7D3Enum; label: string }[] = [
  { value: 0, label: 'draft' },
  { value: 2, label: 'available' },
  { value: 4, label: 'rented' },
  { value: 6, label: 'archived' },
];

const ALL_STATUSES: { value: Status7D3Enum; label: string }[] = [
  { value: 0, label: 'draft' },
  { value: 2, label: 'available' },
  { value: 3, label: 'reserved' },
  { value: 4, label: 'rented' },
  { value: 5, label: 'sold' },
  { value: 6, label: 'archived' },
];

const getStatusesForSalesType = (salesType: SalesTypeEnum | '' | undefined) => {
  if (salesType === 'sell' || salesType === 'donate' || salesType === 'want_buy') {
    return SELL_DONATE_STATUSES;
  }
  if (salesType === 'rent' || salesType === 'borrow' || salesType === 'want_rent') {
    return RENT_BORROW_STATUSES;
  }
  return ALL_STATUSES;
};

export const StatusField = ({
  formData,
  setFormData,
  disabled,
  fieldStates,
  onFieldChange,
}: StatusFieldProps) => {
  const { t } = useLanguage();

  const statuses = getStatusesForSalesType(formData.sales_type);

  return (
    <div className="flex-1 max-w-xs">
      <Select
        id="status"
        label={t('editItem.status')}
        placeholder={t('editItem.selectStatus')}
        value={formData.status === '' ? null : String(formData.status)}
        onChange={value => {
          if (value !== null) {
            const statusValue = Number(value) as Status7D3Enum;
            setFormData({
              ...formData,
              status: statusValue,
            });
            onFieldChange?.('status', statusValue);
          }
        }}
        data={statuses.map(status => ({
          value: String(status.value),
          label: t(`status.${status.label}`),
        }))}
        disabled={disabled}
        allowDeselect={false}
        rightSection={getFieldRightSection('status', fieldStates)}
        error={getFieldError('status', fieldStates)}
        styles={getFieldStyles('status', fieldStates)}
      />
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
    <div className="flex-1 max-w-xs">
      <Select
        id="visibility"
        label={t('editItem.visibility')}
        placeholder={t('editItem.selectVisibility')}
        value={formData.visibility !== '' ? String(formData.visibility) : null}
        onChange={value => {
          if (value !== null) {
            const visibilityValue = Number(value) as VisibilityEnum;
            setFormData({
              ...formData,
              visibility: visibilityValue,
            });
            onFieldChange?.('visibility', visibilityValue);
          }
        }}
        data={visibilities.map(v => ({
          value: String(v.value),
          label: t(`visibility.${v.label}`),
        }))}
        disabled={disabled}
        allowDeselect={false}
        rightSection={getFieldRightSection('visibility', fieldStates)}
        error={getFieldError('visibility', fieldStates)}
        styles={getFieldStyles('visibility', fieldStates)}
      />
    </div>
  );
};

interface LocationFieldProps {
  formData: {
    category: CategoryEnum | '';
    location?: string | null;
  };
  setFormData: (data: any) => void;
  disabled?: boolean;
  fieldStates?: FieldStates;
  onFieldChange?: (fieldName: string, value: unknown) => void;
}

/**
 * Lets the owner choose where an item is currently kept: their own place (the
 * default, represented by no location) or one of the curated locations that
 * apply to the item's category (e.g. a library shelf for books or a shared
 * workspace area for tools).
 */
export const LocationField = ({
  formData,
  setFormData,
  disabled,
  fieldStates,
  onFieldChange,
}: LocationFieldProps) => {
  const { t } = useLanguage();
  const category = formData.category || undefined;
  const { data: locations = [], isLoading } = useLocations(category);

  const ownerOption = { value: '', label: t('editItem.locationOwnerPlace') };

  // Group locations by their optional section so the picker stays organised.
  const grouped = new Map<string, { value: string; label: string }[]>();
  for (const loc of locations) {
    const key = loc.section || '';
    const option = { value: loc.id, label: loc.name };
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(option);
    } else {
      grouped.set(key, [option]);
    }
  }

  // Section-less locations sit at the top level; the rest become groups.
  type LocationOption = { value: string; label: string };
  const data: Array<LocationOption | { group: string; items: LocationOption[] }> = [ownerOption];
  for (const [section, items] of grouped.entries()) {
    if (section) {
      data.push({ group: section, items });
    } else {
      data.push(...items);
    }
  }

  return (
    <div className="max-w-md">
      <Select
        id="location"
        label={t('editItem.location')}
        placeholder={isLoading ? t('editItem.locationLoading') : t('editItem.selectLocation')}
        value={formData.location ? String(formData.location) : ''}
        onChange={value => {
          const normalised = value || '';
          setFormData({ ...formData, location: normalised });
          // Persist null when the item is at the owner's own place.
          onFieldChange?.('location', normalised === '' ? null : normalised);
        }}
        data={data}
        disabled={disabled || isLoading}
        allowDeselect={false}
        searchable
        rightSection={getFieldRightSection('location', fieldStates)}
        error={getFieldError('location', fieldStates)}
        styles={getFieldStyles('location', fieldStates)}
      />
    </div>
  );
};
