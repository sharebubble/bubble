import { useLanguage } from '@/contexts/LanguageContext';
import { usePaymentSuggestion, useRecordPayment } from '@/hooks/usePayments';
import { useAppConfig } from '@/hooks/useAppConfig';
import { formatPrice } from '@/lib/currency';
import type { BookingWithPayment } from '@/services/custom/payments';
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
import { Info } from 'lucide-react';
import { useState } from 'react';

/** The slice of a booking this dialog needs to describe what was paid for. */
export interface PayableBooking extends BookingWithPayment {
  item_name?: string | null;
}

interface RecordPaymentDialogProps {
  booking: PayableBooking | null;
  opened: boolean;
  onClose: () => void;
}

interface PaymentFormProps {
  booking: PayableBooking;
  /** Pre-filled amount, or null when there is nothing to go on. */
  suggested: number | null;
  /** True when a price had been agreed rather than left to the payer. */
  agreed: boolean;
  /** True when the suggestion is what this member paid last time. */
  fromPrevious: boolean;
  currency: string;
  onClose: () => void;
}

/**
 * The form itself, mounted only once its suggestion has loaded.
 *
 * Splitting it out means the initial amount can be a `useState` initialiser
 * rather than an effect that writes state after the fetch resolves.
 */
const PaymentForm = ({
  booking,
  suggested,
  agreed,
  fromPrevious,
  currency,
  onClose,
}: PaymentFormProps) => {
  const { t } = useLanguage();
  const { voluntaryPaymentMax } = useAppConfig();
  const recordPayment = useRecordPayment(booking.payment?.item ?? undefined);
  const [amount, setAmount] = useState<number>(suggested ?? 0);

  // Keep the slider usable when the agreed price is above the configured
  // ceiling: the bound follows the amount rather than clipping it.
  const sliderMax = Math.max(voluntaryPaymentMax, Math.ceil(amount));

  const handleSave = () => {
    recordPayment.mutate(
      { booking: booking.id, amount: amount.toFixed(2) },
      { onSuccess: onClose },
    );
  };

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        {agreed
          ? t('payments.dialogDescriptionAgreed', { itemName: booking.item_name ?? '' })
          : t('payments.dialogDescriptionFree', { itemName: booking.item_name ?? '' })}
      </Text>

      {!agreed && (
        <Alert icon={<Info size={16} />} color="blue" variant="light">
          {t('payments.voluntaryHint')}
        </Alert>
      )}

      {fromPrevious && (
        <Text size="xs" c="dimmed">
          {t('payments.rememberedHint')}
        </Text>
      )}

      <Slider
        value={amount}
        onChange={setAmount}
        min={0}
        max={sliderMax}
        step={0.5}
        label={value => formatPrice(value, currency)}
        aria-label={t('payments.amountLabel')}
      />

      <NumberInput
        label={t('payments.amountLabel')}
        value={amount}
        onChange={value => setAmount(typeof value === 'number' ? value : 0)}
        min={0}
        step={0.5}
        decimalScale={2}
        fixedDecimalScale
        prefix={`${currency} `}
      />

      <Group justify="flex-end">
        <Button variant="subtle" onClick={onClose}>
          {t('payments.notNow')}
        </Button>
        <Button onClick={handleSave} disabled={amount <= 0} loading={recordPayment.isPending}>
          {t('payments.save')}
        </Button>
      </Group>
    </Stack>
  );
};

/**
 * Asks the booker what they paid, once a booking has completed.
 *
 * For a priced booking this confirms the amount that was agreed; for a free
 * one it invites a voluntary figure, which is what makes the item's track
 * record meaningful to the next borrower.
 */
export const RecordPaymentDialog = ({ booking, opened, onClose }: RecordPaymentDialogProps) => {
  const { t } = useLanguage();
  const { data: suggestion, isLoading } = usePaymentSuggestion(booking?.id, opened);

  return (
    <Modal opened={opened} onClose={onClose} title={t('payments.dialogTitle')} centered>
      {booking === null || isLoading ? (
        <Group justify="center" py="lg">
          <Loader size="sm" />
        </Group>
      ) : (
        <PaymentForm
          // Remount on a different booking so the amount starts from that
          // booking's own suggestion.
          key={booking.id}
          booking={booking}
          suggested={
            suggestion?.amount != null
              ? Number(suggestion.amount)
              : booking.payment?.amount != null
                ? Number(booking.payment.amount)
                : null
          }
          agreed={suggestion?.agreed ?? false}
          fromPrevious={suggestion?.from_previous ?? false}
          currency={suggestion?.currency ?? booking.payment?.currency ?? 'EUR'}
          onClose={onClose}
        />
      )}
    </Modal>
  );
};
