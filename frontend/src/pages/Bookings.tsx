import {
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Pagination,
  SegmentedControl,
  Select,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { type BookingsFilterParams, useMyBookings, useUpdateBooking } from '@/hooks/useBookings';
import { formatPrice, getRentalPeriodSuffixKey } from '@/lib/currency';
import { cn } from '@/lib/utils';
import type { BookingList } from '@/services/django';
import { format, formatDuration, intervalToDuration, isAfter, isBefore, parseISO } from 'date-fns';
import { Calendar, Clock, Package, Search, Square, User } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// ─── constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = ['10', '20', '50'];
const DEFAULT_PAGE_SIZE = 20;

// BookingStatus values (mirror of the backend IntegerChoices)
const STATUS_PENDING = 1;
const STATUS_CONFIRMED = 3;
const STATUS_COMPLETED = 4;

// Approved bookings shown by default; pending (1) is added via the checkbox.
const APPROVED_STATUSES = [String(STATUS_CONFIRMED), String(STATUS_COMPLETED)];

// ─── helpers ────────────────────────────────────────────────────────────────

const formatBookedDuration = (from: string, to: string | null | undefined): string => {
  const start = parseISO(from);
  const end = to ? parseISO(to) : new Date();
  if (isAfter(start, end)) return '—';
  const duration = intervalToDuration({ start, end });
  return (
    formatDuration(duration, { format: ['days', 'hours', 'minutes'], delimiter: ' ' }) || '< 1 min'
  );
};

type BookingState = 'active' | 'upcoming' | 'past';

const getBookingState = (booking: BookingList): BookingState => {
  const now = new Date();
  const from = booking.time_from ? parseISO(booking.time_from) : null;
  const to = booking.time_to ? parseISO(booking.time_to) : null;
  if (!from) return 'upcoming';
  if (to && isBefore(to, now)) return 'past';
  if (isBefore(from, now) && (!to || isAfter(to, now))) return 'active';
  return 'upcoming';
};

// Left-border accent colour per state (theme-aware Mantine CSS variables).
const accentColor = (state: BookingState, isPending: boolean): string => {
  if (isPending) return 'var(--mantine-color-yellow-6)';
  if (state === 'active') return 'var(--mantine-color-teal-6)';
  if (state === 'upcoming') return 'var(--mantine-color-blue-6)';
  return 'var(--mantine-color-gray-5)';
};

// ─── row component ───────────────────────────────────────────────────────────

interface BookingRowProps {
  booking: BookingList;
  state: BookingState;
  t: (key: string) => string;
  currentUsername: string | undefined;
  onClick: (id: string) => void;
  onEnd: (id: string) => void;
  isEnding: boolean;
}

const BookingRow = ({
  booking,
  state,
  t,
  currentUsername,
  onClick,
  onEnd,
  isEnding,
}: BookingRowProps) => {
  const isOwner = booking.user?.username !== currentUsername;
  const isPending = booking.status === STATUS_PENDING;
  const itemTitle = booking.item_details?.name ?? t('bookings.item');
  const itemImage = booking.item_details?.first_image;
  const userName = booking.user?.name || booking.user?.username || '—';
  const price = booking.item_details?.price;
  const currency = booking.item_details?.price_currency;

  const stateBadge =
    state === 'active' ? (
      <Badge color="teal" size="sm" className="shrink-0">
        {t('bookings.active')}
      </Badge>
    ) : state === 'upcoming' ? (
      <Badge variant="light" color="blue" size="sm" className="shrink-0">
        {t('bookings.upcoming')}
      </Badge>
    ) : (
      <Badge variant="outline" color="gray" size="sm" className="shrink-0">
        {t('bookings.past')}
      </Badge>
    );

  return (
    <Card
      withBorder
      padding="sm"
      className={cn(
        'transition-all cursor-pointer',
        state !== 'active' && 'hover:bg-[var(--mantine-color-gray-0)]',
        state === 'past' && 'opacity-60',
      )}
      style={{
        borderLeftWidth: 4,
        borderLeftColor: accentColor(state, isPending),
        backgroundColor: state === 'active' ? 'var(--mantine-color-teal-light)' : undefined,
      }}
      onClick={() => onClick(booking.id!)}
    >
      <div className="flex gap-3 items-center">
        {/* Thumbnail */}
        <div className="w-12 h-12 rounded overflow-hidden bg-[var(--mantine-color-gray-1)] shrink-0">
          {itemImage ? (
            <img src={itemImage} alt={itemTitle} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Package size={20} color="var(--mantine-color-dimmed)" />
            </div>
          )}
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Text component="span" size="sm" fw={600} truncate>
              {itemTitle}
            </Text>
            {stateBadge}
            {isPending && (
              <Badge variant="light" color="yellow" size="sm" className="shrink-0">
                {t('bookings.pending')}
              </Badge>
            )}
          </div>
          <Text component="div" size="xs" c="dimmed" className="flex flex-wrap gap-x-4 gap-y-0.5">
            <span className="flex items-center gap-1">
              <User size={12} className="shrink-0" />
              {userName}
            </span>
            <span className="flex items-center gap-1">
              <Calendar size={12} className="shrink-0" />
              {booking.time_from ? format(parseISO(booking.time_from), 'dd MMM yy, HH:mm') : '—'}
              {booking.time_to && <> → {format(parseISO(booking.time_to), 'dd MMM yy, HH:mm')}</>}
              {!booking.time_to && state === 'active' && (
                <Text component="span" size="xs" c="teal.7" fw={500} className="ml-1">
                  {t('bookings.ongoing')}
                </Text>
              )}
            </span>
            <span className="flex items-center gap-1">
              <Clock size={12} className="shrink-0" />
              {booking.time_from ? formatBookedDuration(booking.time_from, booking.time_to) : '—'}
            </span>
            {price && (
              <Text component="span" size="xs" fw={500} c="var(--mantine-color-text)">
                {formatPrice(price, currency)}
                {booking.item_details?.sales_type === 'rent' &&
                  ` ${t(getRentalPeriodSuffixKey(booking.item_details?.rental_period))}`}
              </Text>
            )}
          </Text>
        </div>

        {/* End booking button — only for active bookings owned by the current user */}
        {state === 'active' && isOwner && !isPending && (
          <Button
            size="xs"
            color="red"
            className="shrink-0"
            disabled={isEnding}
            leftSection={<Square size={12} />}
            onClick={e => {
              e.stopPropagation();
              onEnd(booking.id!);
            }}
          >
            <span className="hidden sm:inline">{t('bookings.endBooking')}</span>
          </Button>
        )}
      </div>
    </Card>
  );
};

// ─── main page ───────────────────────────────────────────────────────────────

type Direction = 'upcoming' | 'past';
type Role = '' | 'owner' | 'renter';

const MyBookingsPage = () => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const updateBookingMutation = useUpdateBooking();
  const [endingId, setEndingId] = useState<string | null>(null);

  // ── controls ───────────────────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch] = useDebouncedValue(searchInput.trim(), 300);
  const [direction, setDirection] = useState<Direction>('upcoming');
  const [role, setRole] = useState<Role>('');
  const [showPending, setShowPending] = useState(false);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  const isSearching = debouncedSearch.length > 0;

  // Reset to the first page whenever any filter changes.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, direction, role, showPending, pageSize]);

  const handleEndBooking = async (id: string) => {
    setEndingId(id);
    try {
      await updateBookingMutation.mutateAsync({
        id,
        data: { status: STATUS_COMPLETED, time_to: new Date().toISOString() },
      });
    } finally {
      setEndingId(null);
    }
  };

  // ── query ────────────────────────────────────────────────────────────────
  const statuses = useMemo(
    () => (showPending ? [String(STATUS_PENDING), ...APPROVED_STATUSES] : APPROVED_STATUSES),
    [showPending],
  );

  const queryParams = useMemo<BookingsFilterParams>(() => {
    const base: BookingsFilterParams = {
      status: statuses,
      page,
      page_size: pageSize,
      ...(role ? { role } : {}),
    };
    // When searching we span the whole timeline (past, current & upcoming),
    // ordered newest-first so recent/upcoming matches surface at the top.
    if (isSearching) {
      return { ...base, search: debouncedSearch, ordering: '-time_from' };
    }
    // Otherwise browse one direction of the agenda at a time.
    return {
      ...base,
      temporal: direction,
      ordering: direction === 'past' ? '-time_from' : 'time_from',
    };
  }, [statuses, page, pageSize, role, isSearching, debouncedSearch, direction]);

  const { data, isLoading, isFetching } = useMyBookings(queryParams);
  const bookings = data?.results ?? [];
  const totalCount = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // Keep the current page in range if the result set shrinks (e.g. after a
  // booking is ended and the list refetches with a smaller total).
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const annotated = useMemo(
    () => bookings.map(b => ({ booking: b, state: getBookingState(b) })),
    [bookings],
  );

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      {/* Header */}
      <Title order={1} className="mb-4">
        {t('bookings.title')}
      </Title>

      {/* Controls */}
      <div className="flex flex-col gap-3 mb-5">
        {/* Search + pending toggle */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <TextInput
            className="w-full flex-1"
            leftSection={<Search size={16} />}
            placeholder={t('bookings.searchPlaceholder')}
            aria-label={t('bookings.searchPlaceholder')}
            value={searchInput}
            onChange={e => setSearchInput(e.currentTarget.value)}
          />
          <Checkbox
            className="shrink-0"
            checked={showPending}
            onChange={e => setShowPending(e.currentTarget.checked)}
            label={t('bookings.showPending')}
          />
        </div>

        {/* Direction + role + page size */}
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-3 items-center">
            {!isSearching && (
              <SegmentedControl
                value={direction}
                onChange={value => setDirection(value as Direction)}
                data={[
                  { label: t('bookings.directionPast'), value: 'past' },
                  { label: t('bookings.directionUpcoming'), value: 'upcoming' },
                ]}
              />
            )}
            <SegmentedControl
              size="xs"
              value={role || 'all'}
              onChange={value => setRole(value === 'all' ? '' : (value as Role))}
              data={[
                { label: t('bookings.filterAll'), value: 'all' },
                { label: t('bookings.filterOwner'), value: 'owner' },
                { label: t('bookings.filterRenter'), value: 'renter' },
              ]}
            />
          </div>
          <Group gap="xs" wrap="nowrap">
            <Text size="sm" c="dimmed">
              {t('bookings.perPage')}
            </Text>
            <Select
              w={84}
              size="xs"
              value={String(pageSize)}
              onChange={value => value && setPageSize(Number(value))}
              data={PAGE_SIZE_OPTIONS}
              allowDeselect={false}
              aria-label={t('bookings.perPage')}
            />
          </Group>
        </div>

        {isSearching && (
          <Text size="xs" c="dimmed">
            {t('bookings.searchingAll')}
          </Text>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Text c="dimmed">{t('common.loading')}</Text>
        </div>
      ) : annotated.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <Calendar size={56} color="var(--mantine-color-dimmed)" className="opacity-40" />
          <Text c="dimmed">
            {isSearching ? t('bookings.noSearchResults') : t('bookings.noBookings')}
          </Text>
        </div>
      ) : (
        <div
          className={cn(
            'flex flex-col gap-2 transition-opacity',
            isFetching && 'opacity-60 pointer-events-none',
          )}
        >
          {annotated.map(({ booking, state }) => (
            <BookingRow
              key={booking.id}
              booking={booking}
              state={state}
              t={t}
              onClick={id => navigate(`/requests/${id}`)}
              onEnd={handleEndBooking}
              isEnding={endingId === booking.id}
              currentUsername={user?.username}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center pt-5">
          <Pagination total={totalPages} value={page} onChange={setPage} />
        </div>
      )}
    </div>
  );
};

export default MyBookingsPage;
