import { useLanguage } from '@/contexts/LanguageContext';
import { useItemPaymentSummary, useItemPayments } from '@/hooks/usePayments';
import { formatPrice } from '@/lib/currency';
import { Badge, Card, Group, Stack, Text, Title } from '@mantine/core';
import { Receipt } from 'lucide-react';

interface ItemPaymentRecordProps {
  itemId: string | undefined;
}

/**
 * What an item has actually been paid, visible to everyone who can see it.
 *
 * On a free item this is the point of the whole feature: a list of voluntary
 * amounts tells the next borrower what the thing has been worth to people,
 * which a price of zero never could.
 */
export const ItemPaymentRecord = ({ itemId }: ItemPaymentRecordProps) => {
  const { t, language } = useLanguage();
  const { data: payments } = useItemPayments(itemId);
  const { data: summary } = useItemPaymentSummary(itemId);

  // Nothing recorded yet — say nothing rather than show an empty shell.
  if (!payments || payments.length === 0) {
    return null;
  }

  const currency = summary?.currency ?? payments[0]?.currency ?? 'EUR';

  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group gap="xs">
          <Receipt size={18} />
          <Title order={4}>{t('payments.recordTitle')}</Title>
        </Group>

        {summary && (
          <Text size="sm" c="dimmed">
            {t('payments.recordSummary', {
              count: summary.count,
              total: formatPrice(summary.total, currency),
            })}
            {summary.average !== null &&
              ` · ${t('payments.recordAverage', {
                average: formatPrice(summary.average, currency),
              })}`}
          </Text>
        )}

        <Stack gap="xs">
          {payments.map(payment => (
            <Group key={payment.id} justify="space-between" wrap="nowrap">
              <Group gap="xs" wrap="nowrap">
                <Text size="sm">{payment.payer?.name || payment.payer?.username || '—'}</Text>
                {payment.voluntary && (
                  <Badge size="xs" variant="light" color="teal">
                    {t('payments.voluntaryBadge')}
                  </Badge>
                )}
              </Group>
              <Group gap="sm" wrap="nowrap">
                <Text size="xs" c="dimmed">
                  {new Date(payment.created_at).toLocaleDateString(language)}
                </Text>
                <Text size="sm" fw={500}>
                  {formatPrice(payment.amount, payment.currency)}
                </Text>
              </Group>
            </Group>
          ))}
        </Stack>
      </Stack>
    </Card>
  );
};
