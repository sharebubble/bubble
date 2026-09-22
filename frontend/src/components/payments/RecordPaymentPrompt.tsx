import { useLanguage } from '@/contexts/LanguageContext';
import { formatPrice } from '@/lib/currency';
import { Alert, Button, Group, Text } from '@mantine/core';
import { HandCoins } from 'lucide-react';
import { useState } from 'react';
import { RecordPaymentDialog, type PayableBooking } from './RecordPaymentDialog';

interface RecordPaymentPromptProps {
  booking: PayableBooking;
}

/**
 * Asked of the booker once their booking has completed.
 *
 * Deliberately after the fact rather than up front: nothing was charged, so
 * the question is what it turned out to be worth, not what it should cost.
 */
export const RecordPaymentPrompt = ({ booking }: RecordPaymentPromptProps) => {
  const { t } = useLanguage();
  const [opened, setOpened] = useState(false);

  const recorded = booking.payment;

  return (
    <>
      <Alert icon={<HandCoins size={16} />} color={recorded ? 'teal' : 'blue'} variant="light">
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
          <div>
            <Text size="sm" fw={500}>
              {recorded ? t('payments.recordedTitle') : t('payments.promptTitle')}
            </Text>
            <Text size="sm" c="dimmed">
              {recorded
                ? t('payments.recordedDescription', {
                    amount: formatPrice(recorded.amount, recorded.currency),
                  })
                : t('payments.promptDescription')}
            </Text>
          </div>
          <Button size="xs" variant={recorded ? 'subtle' : 'light'} onClick={() => setOpened(true)}>
            {recorded ? t('payments.change') : t('payments.setAmount')}
          </Button>
        </Group>
      </Alert>

      <RecordPaymentDialog booking={booking} opened={opened} onClose={() => setOpened(false)} />
    </>
  );
};
