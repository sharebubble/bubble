import { useLanguage } from '@/contexts/LanguageContext';
import { useMyBookings } from '@/hooks/useBookings';
import { formatPrice } from '@/lib/currency';
import { cn } from '@/lib/utils';
import type { BookingList } from '@/services/django';
import { Badge, Card, Loader, Text } from '@mantine/core';
import { format, isAfter, isBefore, parseISO } from 'date-fns';
import { CalendarCheck, ChevronRight, Package } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// BookingStatus values (mirror of the backend IntegerChoices)
const STATUS_CONFIRMED = 3;
const STATUS_COMPLETED = 4;
const APPROVED_STATUSES = [String(STATUS_CONFIRMED), String(STATUS_COMPLETED)];

// How many bookings to surface in the compact widget.
const WIDGET_LIMIT = 4;

type BookingState = 'active' | 'upcoming';

const getBookingState = (booking: BookingList): BookingState => {
  const now = new Date();
  const from = booking.time_from ? parseISO(booking.time_from) : null;
  const to = booking.time_to ? parseISO(booking.time_to) : null;
  if (from && isBefore(from, now) && (!to || isAfter(to, now))) return 'active';
  return 'upcoming';
};

const BookingLine = ({ booking }: { booking: BookingList }) => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const state = getBookingState(booking);
  const itemTitle = booking.item_details?.name ?? t('bookings.item');
  const itemImage = booking.item_details?.first_image;
  const price = booking.item_details?.price;
  const currency = booking.item_details?.price_currency;

  return (
    <button
      type="button"
      onClick={() => navigate(`/requests/${booking.id}`)}
      className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-[var(--mantine-color-gray-0)]"
      style={{
        borderLeft: `3px solid ${
          state === 'active'
            ? 'var(--mantine-color-teal-6)'
            : 'var(--mantine-color-blue-6)'
        }`,
      }}
    >
      {/* Thumbnail */}
      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md bg-[var(--mantine-color-gray-1)]">
        {itemImage ? (
          <img src={itemImage} alt={itemTitle} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Package size={18} color="var(--mantine-color-dimmed)" />
          </div>
        )}
      </div>

      {/* Details */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Text component="span" size="sm" fw={600} truncate className="flex-1">
            {itemTitle}
          </Text>
          <Badge
            color={state === 'active' ? 'teal' : 'blue'}
            variant={state === 'active' ? 'filled' : 'light'}
            size="xs"
            className="shrink-0"
          >
            {state === 'active' ? t('bookings.active') : t('bookings.upcoming')}
          </Badge>
        </div>
        <Text component="div" size="xs" c="dimmed" truncate>
          {booking.time_from ? format(parseISO(booking.time_from), 'dd MMM, HH:mm') : '—'}
          {booking.time_to && <> → {format(parseISO(booking.time_to), 'dd MMM, HH:mm')}</>}
          {price ? ` · ${formatPrice(price, currency)}` : ''}
        </Text>
      </div>

      <ChevronRight size={16} className="shrink-0 text-[var(--mantine-color-dimmed)]" />
    </button>
  );
};

export const UpcomingBookingsWidget = ({ className }: { className?: string }) => {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const { data, isLoading } = useMyBookings({
    status: APPROVED_STATUSES,
    temporal: 'upcoming',
    ordering: 'time_from',
    page_size: WIDGET_LIMIT,
  });

  const bookings = data?.results ?? [];

  return (
    <Card withBorder radius="lg" padding="md" className={cn(className)}>
      <button
        type="button"
        onClick={() => navigate('/bookings')}
        className="mb-3 flex w-full items-center gap-2 text-left"
      >
        <CalendarCheck size={18} className="text-[var(--mantine-color-green-6)]" />
        <div className="flex-1">
          <Text component="span" fw={700} size="sm">
            {t('home.bookingsTitle')}
          </Text>
          <Text component="span" size="xs" c="dimmed" className="ml-2">
            {t('home.bookingsSubtitle')}
          </Text>
        </div>
        <ChevronRight size={16} className="text-[var(--mantine-color-dimmed)]" />
      </button>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader size="sm" />
        </div>
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
