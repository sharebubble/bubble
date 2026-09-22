import { useLanguage } from '@/contexts/LanguageContext';
import { useMyBalance } from '@/hooks/usePayments';
import { formatPrice } from '@/lib/currency';
import { Card, Group, Stack, Text } from '@mantine/core';
import { Wallet } from 'lucide-react';

/**
 * The member's own running balance across every payment they recorded.
 *
 * Derived from their postings rather than stored, so it can never drift out
 * of step with the history behind it. Positive means more was received than
 * paid out; it is a record of settled amounts, not a balance the platform
 * holds or will pay out.
 */
export const BalanceCard = () => {
  const { t } = useLanguage();
  const { data: balance } = useMyBalance();

  // Nothing recorded yet — a row of zeroes would only be noise.
  if (!balance || (Number(balance.paid_out) === 0 && Number(balance.received) === 0)) {
    return null;
  }

  const net = Number(balance.balance);

  return (
    <Card withBorder padding="md">
      <Stack gap="xs">
        <Group gap="xs">
          <Wallet size={18} aria-hidden="true" />
          <Text fw={600}>{t('payments.balanceTitle')}</Text>
        </Group>

        <Text size="xl" fw={700} c={net < 0 ? 'red.6' : 'teal.7'}>
          {formatPrice(balance.balance, balance.currency)}
        </Text>

        <Group gap="lg">
          <Text size="sm" c="dimmed">
            {t('payments.balancePaidOut')}: {formatPrice(balance.paid_out, balance.currency)}
          </Text>
          <Text size="sm" c="dimmed">
            {t('payments.balanceReceived')}: {formatPrice(balance.received, balance.currency)}
          </Text>
        </Group>
      </Stack>
    </Card>
  );
};
