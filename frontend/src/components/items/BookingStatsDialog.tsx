import { useLanguage } from '@/contexts/LanguageContext';
import { useItemBookingHistory } from '@/hooks/useItemBookingHistory';
import type { ItemBookingHistoryEntry } from '@/services/custom/itemBookings';
import { Avatar, Group, Modal, Stack, Text } from '@mantine/core';
import { formatDuration, intervalToDuration } from 'date-fns';
import { ChartBar } from 'lucide-react';

interface BookingStatsDialogProps {
  itemId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface UserTotal {
  name: string;
  totalMs: number;
}

/** Milliseconds a single booking occupied the item — open-ended bookings count up to now. */
const bookingDurationMs = (entry: ItemBookingHistoryEntry): number => {
  if (!entry.time_from) return 0;
  const start = new Date(entry.time_from).getTime();
  const end = entry.time_to ? new Date(entry.time_to).getTime() : Date.now();
  return Math.max(0, end - start);
};

const summarizeByUser = (
  bookings: ItemBookingHistoryEntry[],
  anonymousLabel: string,
): UserTotal[] => {
  const totals = new Map<string, number>();
  for (const entry of bookings) {
    const ms = bookingDurationMs(entry);
    if (ms <= 0) continue;
    const name = entry.booker || anonymousLabel;
    totals.set(name, (totals.get(name) ?? 0) + ms);
  }
  // Longest total booking time first.
  return Array.from(totals, ([name, totalMs]) => ({ name, totalMs })).sort(
    (a, b) => b.totalMs - a.totalMs,
  );
};

const formatTotal = (totalMs: number): string =>
  formatDuration(intervalToDuration({ start: 0, end: totalMs }), {
    format: ['years', 'months', 'days', 'hours', 'minutes'],
    delimiter: ' ',
  }) || '< 1 min';

/** Popup showing, per user, the summed booking time for this item — longest total first. */
export const BookingStatsDialog = ({ itemId, open, onOpenChange }: BookingStatsDialogProps) => {
  const { t } = useLanguage();
  const { data: bookings, isLoading } = useItemBookingHistory(open ? itemId : undefined);

  const totals = summarizeByUser(bookings ?? [], t('itemBookings.anonymousBooker'));

  return (
    <Modal
      opened={open}
      onClose={() => onOpenChange(false)}
      size="md"
      title={
        <span className="flex items-center gap-2 font-semibold">
          <ChartBar size={16} />
          {t('itemBookings.statsTitle')}
        </span>
      }
    >
      {isLoading ? (
        <Text component="div" size="sm" c="dimmed" className="py-8 text-center">
          {t('common.loading')}
        </Text>
      ) : totals.length === 0 ? (
        <Text component="div" size="sm" c="dimmed" className="py-8 text-center">
          {t('itemBookings.statsEmpty')}
        </Text>
      ) : (
        <Stack gap="xs">
          {totals.map(({ name, totalMs }) => (
            <Group key={name} justify="space-between" wrap="nowrap" gap="xs">
              <Group gap="xs" wrap="nowrap" className="min-w-0">
                <Avatar radius="xl" size="sm" color="initials" name={name}>
                  {name.charAt(0).toUpperCase()}
                </Avatar>
                <Text size="sm" fw={500} className="truncate">
                  {name}
                </Text>
              </Group>
              <Text size="sm" c="dimmed" className="shrink-0">
                {formatTotal(totalMs)}
              </Text>
            </Group>
          ))}
        </Stack>
      )}
    </Modal>
  );
};
