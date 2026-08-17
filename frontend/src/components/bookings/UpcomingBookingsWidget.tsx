import { getBookingStatusBadge } from '@/components/bookings/status';
import { useLanguage } from '@/contexts/LanguageContext';
import { useMyBookings } from '@/hooks/useBookings';
import { formatPrice } from '@/lib/currency';
import { cn } from '@/lib/utils';
import type { BookingList } from '@/services/django';
import { Badge, Card, Loader, Text, UnstyledButton } from '@mantine/core';
import { format, isAfter, isBefore, parseISO } from 'date-fns';
import { CalendarCheck, ChevronRight, Package } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// How many bookings to surface in the compact widget.
const WIDGET_LIMIT = 5;

type BookingState = 'active' | 'upcoming' | 'past';

// Accent colour for the row's leading edge — a temporal cue that complements
// the status badge rather than repeating it.
const STATE_COLORS: Record<BookingState, string> = {
  active: 'var(--mantine-color-teal-6)',
  upcoming: 'var(--mantine-color-blue-6)',
  past: 'var(--mantine-color-gray-4)',
};

const getBookingState = (booking: BookingList): BookingState => {
  const now = new Date();
  const from = booking.time_from ? parseISO(booking.time_from) : null;
  const to = booking.time_to ? parseISO(booking.time_to) : null;
  if (from && isBefore(from, now) && (!to || isAfter(to, now))) return 'active';
  if (from && isAfter(from, now)) return 'upcoming';
  return 'past';
};

const BookingLine = ({ booking }: { booking: BookingList }) => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const state = getBookingState(booking);
  const status = getBookingStatusBadge(booking.status);
  const itemTitle = booking.item_details?.name ?? t('bookings.item');
  const itemImage = booking.item_details?.first_image;
  const price = booking.item_details?.price;
  const currency = booking.item_details?.price_currency;

  return (
    <UnstyledButton
      onClick={() => navigate(`/requests/${booking.id}`)}
      className="flex w-full items-center gap-3 p-2 text-left"
      style={{
        borderRadius: 'var(--mantine-radius-md)',
        borderLeft: `3px solid ${STATE_COLORS[state]}`,
      }}
    >
      {/* Thumbnail */}
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden"
        style={{
          borderRadius: 'var(--mantine-radius-sm)',
          background: 'var(--mantine-color-default-hover)',
        }}
      >
        {itemImage ? (
          <img src={itemImage} alt={itemTitle} className="h-full w-full object-cover" />
        ) : (
          <Package size={18} color="var(--mantine-color-dimmed)" aria-hidden="true" />
        )}
      </div>

      {/* Details */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Text component="span" size="sm" fw={600} truncate className="flex-1">
            {itemTitle}
          </Text>
          <Badge color={status.color} variant={status.variant} size="xs" className="shrink-0">
            {t(status.labelKey)}
          </Badge>
        </div>
        <Text component="div" size="xs" c="dimmed" truncate>
          {booking.time_from ? format(parseISO(booking.time_from), 'dd MMM, HH:mm') : '—'}
          {booking.time_to && <> → {format(parseISO(booking.time_to), 'dd MMM, HH:mm')}</>}
          {price ? ` · ${formatPrice(price, currency)}` : ''}
        </Text>
      </div>

      <ChevronRight size={16} color="var(--mantine-color-dimmed)" className="shrink-0" />
    </UnstyledButton>
  );
};

export const UpcomingBookingsWidget = ({ className }: { className?: string }) => {
  const { t } = useLanguage();
  const navigate = useNavigate();

  // Latest bookings across every status, so the start page also surfaces the
  // ones still awaiting a decision — not just the already-approved schedule.
  const { data, isLoading, isError } = useMyBookings({
    ordering: '-time_from',
    page_size: WIDGET_LIMIT,
  });

  const bookings = data?.results ?? [];

  return (
    <Card withBorder radius="lg" padding="md" className={cn(className)}>
      <UnstyledButton
        onClick={() => navigate('/bookings')}
        className="mb-3 flex w-full items-center gap-2 text-left"
      >
        <CalendarCheck size={18} color="var(--mantine-color-green-6)" aria-hidden="true" />
        <div className="flex-1">
          <Text component="span" fw={700} size="sm">
            {t('home.bookingsTitle')}
          </Text>
          {/* Mantine's Text root resets margin and is unlayered, so a Tailwind
              `ml-*` utility gets overridden — use the style prop instead. */}
          <Text component="span" size="xs" c="dimmed" ml="xs">
            {t('home.bookingsSubtitle')}
          </Text>
        </div>
        <ChevronRight size={16} color="var(--mantine-color-dimmed)" aria-hidden="true" />
      </UnstyledButton>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader size="sm" />
        </div>
      ) : isError ? (
        <Text size="sm" c="red" className="py-4 text-center">
          {t('common.loadingError')}
        </Text>
      ) : bookings.length === 0 ? (
        <Text size="sm" c="dimmed" className="py-4 text-center">
          {t('home.noBookings')}
        </Text>
      ) : (
        <div className="flex flex-col gap-1.5">
          {bookings.map(booking => (
            <BookingLine key={booking.id} booking={booking} />
          ))}
        </div>
      )}
    </Card>
  );
};
