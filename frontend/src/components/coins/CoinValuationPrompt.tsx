import { useLanguage } from '@/contexts/LanguageContext';
import { useCoinConfig } from '@/hooks/useAppConfig';
import { formatCoins, isCoinRentalSalesType } from '@/lib/coins';
import { getRentalPeriodSuffixKey } from '@/lib/currency';
import type { CoinValuationBooking } from '@/services/custom/coins';
import { Alert, Button, Group, Text } from '@mantine/core';
import { Coins } from 'lucide-react';
import { useState } from 'react';
import { CoinValuationDialog } from './CoinValuationDialog';

interface CoinValuationPromptProps {
  /** The settled transaction, as returned by the bookings endpoints. */
  booking: CoinValuationBooking;
}

/**
 * The ask that follows a free transaction: would you like to put a coin value
 * on it? Once a value is recorded the prompt turns into a summary of it,
 * which stays editable.
 */
export const CoinValuationPrompt = ({ booking }: CoinValuationPromptProps) => {
  const { t } = useLanguage();
  const coin = useCoinConfig();
  const [dialogOpen, setDialogOpen] = useState(false);

  const valuation = booking.coin_valuation;
  const isRental = isCoinRentalSalesType(booking.item_details?.sales_type);
  const periodSuffix =
    isRental && valuation?.rate ? t(getRentalPeriodSuffixKey(valuation.rental_period)) : '';

  return (
    <>
      <Alert
        color={valuation ? 'teal' : 'yellow'}
        variant="light"
        icon={<Coins size={18} />}
        title={valuation ? t('coins.recordedTitle') : t('coins.promptTitle')}
      >
        <Group justify="space-between" align="center" wrap="wrap" gap="sm">
          <Text size="sm">
            {valuation
              ? t('coins.recordedDescription')
                  .replace('{amount}', formatCoins(valuation.rate ?? valuation.amount))
                  .replace('{coin}', coin.shortName)
                  .replace('{period}', periodSuffix)
              : t('coins.promptDescription').replace('{coin}', coin.name)}
          </Text>
          <Button
            size="xs"
            variant={valuation ? 'subtle' : 'filled'}
            onClick={() => setDialogOpen(true)}
          >
            {valuation ? t('coins.change') : t('coins.setValue')}
          </Button>
        </Group>
      </Alert>

      <CoinValuationDialog
        booking={booking}
        opened={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
};
