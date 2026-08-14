import { useLanguage } from '@/contexts/LanguageContext';
import { useCoinConfig, type CoinConfig } from '@/hooks/useAppConfig';
import { useCoinValuationSuggestion, useSaveCoinValuation } from '@/hooks/useCoins';
import { formatCoins, isCoinRentalSalesType } from '@/lib/coins';
import { getCurrencySymbol, getHoursPerRentalPeriod } from '@/lib/currency';
import type { CoinValuationBooking } from '@/services/custom/coins';
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  NumberInput,
  Slider,
  Stack,
  Text,
} from '@mantine/core';
import { Coins, Info } from 'lucide-react';
import { useState } from 'react';

interface CoinValuationDialogProps {
  /** The settled transaction being valued. */
  booking: CoinValuationBooking | null;
  opened: boolean;
  onClose: () => void;
}

/** Slider granularity — half a coin is fine enough to place a value. */
const STEP = 0.5;

/** Where the slider starts when nothing was ever picked for this item. */
const DEFAULT_START_FRACTION = 0.1;

interface CoinValuationFormProps {
  booking: CoinValuationBooking;
  coin: CoinConfig;
  /** Where the slider opens: the value picked before, or a sensible default. */
  initialValue: number;
  /** True when the starting value is one this user picked previously. */
  remembered: boolean;
  isRental: boolean;
  rentalPeriod: string;
  onClose: () => void;
}

/**
 * The slider itself. Mounted only once the remembered value is known, so it
 * can start from it without ever overwriting what the user is typing.
 */
const CoinValuationForm = ({
  booking,
  coin,
  initialValue,
  remembered,
  isRental,
  rentalPeriod,
  onClose,
}: CoinValuationFormProps) => {
  const { t } = useLanguage();
  const saveValuation = useSaveCoinValuation();
  const [value, setValue] = useState(initialValue);

  /** Keep the scale usable when someone picked more than the configured max. */
  const max = Math.max(coin.sliderMax, Math.ceil(value / 10) * 10);

  /** Booked duration in rental periods, used to preview the rental total. */
  const hours =
    isRental && booking.time_from && booking.time_to
      ? (new Date(booking.time_to).getTime() - new Date(booking.time_from).getTime()) /
        (1000 * 60 * 60)
      : 0;
  const periods = hours > 0 ? hours / getHoursPerRentalPeriod(rentalPeriod) : null;

  const item = booking.item_details;
  const periodLabel = t(`coins.period.${rentalPeriod}`);
  const valueLabel = isRental
    ? t('coins.rateLabel').replace('{period}', periodLabel)
    : t('coins.totalLabel');

  const handleSave = async () => {
    const amount = value.toFixed(2);
    try {
      await saveValuation.mutateAsync(
        isRental ? { booking: booking.id, rate: amount } : { booking: booking.id, amount },
      );
      onClose();
    } catch {
      // Failures are reported as a toast by the mutation; keep the dialog open
      // so the picked value is not lost.
    }
  };

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        {t('coins.dialogDescription').replace('{itemName}', item?.name ?? '')}
      </Text>

      <Alert icon={<Info size={16} />} color="blue" variant="light">
        <Text size="sm">
          {t('coins.equalValueHint')
            .replace('{coin}', coin.shortName)
            .replace('{currency}', getCurrencySymbol(item?.price_currency))}
        </Text>
      </Alert>

      <div>
        <Group justify="space-between" align="baseline" mb="xs">
          <Text size="sm" fw={500}>
            {valueLabel}
          </Text>
          <Text size="sm" fw={700}>
            {formatCoins(value)} {coin.shortName}
          </Text>
        </Group>

        <Slider
          min={0}
          max={max}
          step={STEP}
          value={value}
          onChange={setValue}
          label={sliderValue => `${formatCoins(sliderValue)} ${coin.shortName}`}
          marks={[
            { value: 0, label: '0' },
            { value: max / 2, label: formatCoins(max / 2) },
            { value: max, label: formatCoins(max) },
          ]}
          aria-label={valueLabel}
        />

        <NumberInput
          mt="xl"
          min={0}
          step={STEP}
          decimalScale={2}
          value={value}
          onChange={next => setValue(typeof next === 'number' ? next : parseFloat(next) || 0)}
          suffix={` ${coin.shortName}`}
          aria-label={valueLabel}
        />
      </div>

      {isRental && periods !== null && (
        <Text size="sm">
          {t('coins.rentalTotal')
            .replace('{periods}', formatCoins(periods))
            .replace('{period}', periodLabel)
            .replace('{total}', formatCoins(value * periods))
            .replace('{coin}', coin.shortName)}
        </Text>
      )}

      {remembered && (
        <Text size="xs" c="dimmed">
          {t('coins.rememberedHint')}
        </Text>
      )}

      <Group justify="flex-end">
        <Button variant="subtle" onClick={onClose} disabled={saveValuation.isPending}>
          {t('coins.notNow')}
        </Button>
        <Button onClick={handleSave} loading={saveValuation.isPending}>
          {t('coins.save')}
        </Button>
      </Group>
    </Stack>
  );
};

/**
 * Asks what a free transaction was worth in community coins.
 *
 * Nothing was paid for these items, so the value is a judgement call: the
 * slider makes it a quick one. For rentals it sets the price per rental
 * period and the resulting total is shown alongside; for everything else it
 * sets the total directly. Whatever was picked for the item last time is
 * offered again as the starting point.
 */
export const CoinValuationDialog = ({ booking, opened, onClose }: CoinValuationDialogProps) => {
  const { t } = useLanguage();
  const coin = useCoinConfig();

  const item = booking?.item_details;
  const isRental = isCoinRentalSalesType(item?.sales_type);
  const existing = booking?.coin_valuation ?? null;
  const rentalPeriod = existing?.rental_period || item?.rental_period || 'h';

  const { data: suggestion, isFetched: suggestionLoaded } = useCoinValuationSuggestion(
    item?.id,
    opened,
  );

  // For rentals the slider carries the per-period rate, otherwise the total.
  const previous = isRental
    ? (existing?.rate ?? suggestion?.rate)
    : (existing?.amount ?? suggestion?.amount);
  const previousValue = previous == null ? NaN : parseFloat(previous);
  const hasPrevious = !isNaN(previousValue);

  const ready = Boolean(booking) && (suggestionLoaded || existing !== null);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <Coins size={18} />
          <span>{t('coins.dialogTitle').replace('{coin}', coin.name)}</span>
        </Group>
      }
    >
      {ready && booking ? (
        <CoinValuationForm
          key={booking.id}
          booking={booking}
          coin={coin}
          initialValue={
            hasPrevious ? previousValue : Math.round(coin.sliderMax * DEFAULT_START_FRACTION)
          }
          remembered={hasPrevious && existing === null}
          isRental={isRental}
          rentalPeriod={rentalPeriod}
          onClose={onClose}
        />
      ) : (
        <Group justify="center" p="lg">
          <Loader size="sm" />
        </Group>
      )}
    </Modal>
  );
};
