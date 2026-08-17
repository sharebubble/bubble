import { useLanguage } from '@/contexts/LanguageContext';
import { useItemBookingHistory } from '@/hooks/useItemBookingHistory';
import type { ItemBookingHistoryEntry } from '@/services/custom/itemBookings';
import { Anchor, Avatar, Group, Loader, Stack, Text } from '@mantine/core';
import { format, formatDistanceStrict } from 'date-fns';
import { History } from 'lucide-react';
import { Link } from 'react-router-dom';

const MAX_INLINE = 5;

interface PreviousRentalsProps {
  itemId: string;
}

/**
 * Inline list of an item's previous rentals shown on the item detail view.
 *
 * Only rendered for rental items to logged-in users (gated by the caller). It
 * reuses the item booking-history endpoint, which returns confirmed + completed
 * bookings with the booker's name (for authenticated viewers) and the rented
 * period — i.e. who rented the item and for how long.
 */
export const PreviousRentals = ({ itemId }: PreviousRentalsProps) => {
  const { t } = useLanguage();
  const { data: bookings, isLoading } = useItemBookingHistory(itemId);

  const formatDuration = (entry: ItemBookingHistoryEntry) => {
    if (!entry.time_from || !entry.time_to) {
      return entry.time_from ? t('itemBookings.openEnded') : '—';
    }
    return formatDistanceStrict(new Date(entry.time_to), new Date(entry.time_from));
  };

  const formatWhen = (entry: ItemBookingHistoryEntry) =>
    entry.time_from ? format(new Date(entry.time_from), 'dd MMM yyyy') : '';

  const heading = (
    <Text component="div" size="sm" fw={600} c="dimmed" className="flex items-center gap-2">
      <History size={16} />
      <span>{t('itemBookings.previousRentals')}</span>
    </Text>
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        {heading}
        <Loader size="sm" />
      </div>
    );
  }

  if (!bookings || bookings.length === 0) {
    return (
      <div className="space-y-2">
        {heading}
        <Text size="sm" c="dimmed">
          {t('itemBookings.noPreviousRentals')}
        </Text>
      </div>
    );
  }

  const visible = bookings.slice(0, MAX_INLINE);
  const remaining = bookings.length - visible.length;

  return (
    <div className="space-y-2">
      {heading}
      <Stack gap="xs">
        {visible.map(entry => (
          <Group key={entry.id} gap="xs" align="center" wrap="nowrap">
            <Avatar radius="xl" size="sm" color="initials" name={entry.booker || undefined}>
              {(entry.booker || '?').charAt(0).toUpperCase()}
            </Avatar>
            <div className="min-w-0">
              <Text size="sm" fw={500} className="truncate">
                {entry.booker || t('itemBookings.anonymousBooker')}
              </Text>
              <Text size="xs" c="dimmed">
                {formatDuration(entry)}
                {formatWhen(entry) ? ` · ${formatWhen(entry)}` : ''}
              </Text>
            </div>
          </Group>
        ))}
      </Stack>
      {remaining > 0 && (
        <Anchor component={Link} to={`/item/${itemId}/bookings`} size="sm">
          {t('itemBookings.seeAll').replace('{count}', String(bookings.length))}
        </Anchor>
      )}
    </div>
  );
};
