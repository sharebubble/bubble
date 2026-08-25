import { BookingStatsDialog } from '@/components/items/BookingStatsDialog';
import { BackButton } from '@/components/layout/BackButton';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCoinConfig } from '@/hooks/useAppConfig';
import { useItem } from '@/hooks/useItem';
import { useItemBookingHistory } from '@/hooks/useItemBookingHistory';
import { formatItemPrice } from '@/lib/coins';
import type { ItemBookingHistoryEntry } from '@/services/custom/itemBookings';
import { Badge, Button, Group, Loader, Table, Text, Title } from '@mantine/core';
import { format, formatDistanceStrict } from 'date-fns';
import { ChartBar } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';

/** Map a booking status code to a coloured badge. */
const StatusBadge = ({ status, label }: { status: number; label: string }) => {
  // 3 = Confirmed, 4 = Completed (the only statuses shown in history).
  const color = status === 3 ? 'green' : 'gray';
  const variant = status === 4 ? 'outline' : 'filled';
  return (
    <Badge color={color} variant={variant}>
      {label}
    </Badge>
  );
};

const ItemBookingHistory = () => {
  const { itemUuid } = useParams<{ itemUuid: string }>();
  const { t } = useLanguage();
  const coin = useCoinConfig();

  const { data: item } = useItem(itemUuid);
  const { data: bookings, isLoading, error } = useItemBookingHistory(itemUuid);
  const [showStats, setShowStats] = useState(false);

  const formatPeriod = (entry: ItemBookingHistoryEntry) => {
    if (!entry.time_from) return '—';
    const from = format(new Date(entry.time_from), 'dd MMM yyyy HH:mm');
    if (!entry.time_to) return `${from} · ${t('itemBookings.openEnded')}`;
    const to = format(new Date(entry.time_to), 'dd MMM yyyy HH:mm');
    return `${from} → ${to}`;
  };

  const formatDuration = (entry: ItemBookingHistoryEntry) => {
    if (!entry.time_from || !entry.time_to) {
      return entry.time_from && !entry.time_to ? t('itemBookings.openEnded') : '—';
    }
    return formatDistanceStrict(new Date(entry.time_to), new Date(entry.time_from));
  };

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <Group justify="space-between" wrap="nowrap" mb="md">
        <div className="flex items-center gap-2">
          <BackButton />
          <Title order={1} size="h3">
            {t('itemBookings.title')}
          </Title>
        </div>
        {bookings && bookings.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            leftSection={<ChartBar size={16} />}
            onClick={() => setShowStats(true)}
          >
            {t('itemBookings.statsButton')}
          </Button>
        )}
      </Group>
      {item?.name && (
        <Text c="dimmed" mb="lg">
          {item.name}
        </Text>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader />
        </div>
      ) : error ? (
        <Text c="red">{t('itemBookings.loadError')}</Text>
      ) : !bookings || bookings.length === 0 ? (
        <Text c="dimmed" className="py-8 text-center">
          {t('itemBookings.empty')}
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={640}>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('itemBookings.period')}</Table.Th>
                <Table.Th>{t('itemBookings.duration')}</Table.Th>
                <Table.Th>{t('itemBookings.status')}</Table.Th>
                <Table.Th>{t('itemBookings.officialPrice')}</Table.Th>
                <Table.Th>{t('itemBookings.paid')}</Table.Th>
                <Table.Th>{t('itemBookings.booker')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {bookings.map(entry => {
                // Both amounts follow the item's pricing unit, so a
                // coin-priced item reads in coins rather than currency.
                const official = formatItemPrice(
                  {
                    price: entry.official_price,
                    price_currency: entry.official_price_currency,
                    price_unit: entry.price_unit,
                  },
                  coin.shortName,
                );
                const paid = formatItemPrice(
                  {
                    price: entry.amount_paid,
                    price_currency: entry.amount_paid_currency,
                    price_unit: entry.price_unit,
                  },
                  coin.shortName,
                );
                return (
                  <Table.Tr key={entry.id}>
                    <Table.Td>{formatPeriod(entry)}</Table.Td>
                    <Table.Td>{formatDuration(entry)}</Table.Td>
                    <Table.Td>
                      <StatusBadge status={entry.status} label={entry.status_display} />
                    </Table.Td>
                    <Table.Td>{official || '—'}</Table.Td>
                    <Table.Td>{paid || '—'}</Table.Td>
                    <Table.Td>{entry.booker || '—'}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {itemUuid && (
        <BookingStatsDialog itemId={itemUuid} open={showStats} onOpenChange={setShowStats} />
      )}
    </div>
  );
};

export default ItemBookingHistory;
