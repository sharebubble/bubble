import BookingConversationPanel from '@/components/bookings/BookingConversationPanel';
import { BOOKING_STATUS, TERMINAL_BOOKING_STATUSES } from '@/components/bookings/status';
import { BackButton } from '@/components/layout/BackButton';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  ScrollArea,
  SegmentedControl,
  Select,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import {
  type BookingsFilterParams,
  useMyBookingsInfinite,
  useUpdateBooking,
} from '@/hooks/useBookings';
import { formatPrice, getRentalPeriodSuffixKey } from '@/lib/currency';
import { cn } from '@/lib/utils';
import type { BookingList } from '@/services/django';
import { format, formatDuration, intervalToDuration, isAfter, isBefore, parseISO } from 'date-fns';
import { Calendar, Clock, Package, Search, Square, User } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';

// ─── constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = ['10', '20', '50'];
const DEFAULT_PAGE_SIZE = 20;

// Approved bookings shown by default; pending is added via the checkbox.
// inProgress covers rentals whose handover has been confirmed.
const APPROVED_STATUSES = [
  String(BOOKING_STATUS.confirmed),
  String(BOOKING_STATUS.inProgress),
  String(BOOKING_STATUS.completed),
];

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
  // Terminal bookings (completed/cancelled/rejected) are always "past",
  // regardless of time fields. This matters for sale-type bookings which
  // never set time_to.
  if (booking.status != null && TERMINAL_BOOKING_STATUSES.includes(booking.status)) return 'past';
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
  selected: boolean;
  onClick: (id: string) => void;
  onEnd: (id: string) => void;
  isEnding: boolean;
}

const BookingRow = ({
  booking,
  state,
  t,
  currentUsername,
  selected,
  onClick,
  onEnd,
  isEnding,
}: BookingRowProps) => {
  const isOwner = booking.user?.username !== currentUsername;
  const isPending = booking.status === BOOKING_STATUS.pending;
  const itemTitle = booking.item_details?.name ?? t('bookings.item');
  const itemImage = booking.item_details?.first_image;
  const userName = booking.user?.name || booking.user?.username || '—';
  const price = booking.item_details?.price;
  const currency = booking.item_details?.price_currency;
  const unreadCount = booking.unread_messages_count;

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
        state !== 'active' && !selected && 'hover:bg-[var(--mantine-color-gray-0)]',
        state === 'past' && !selected && 'opacity-60',
        selected && 'ring-2 ring-[var(--mantine-color-green-5)]',
      )}
      style={{
        borderLeftWidth: 4,
        borderLeftColor: accentColor(state, isPending),
        backgroundColor: selected
          ? 'var(--mantine-color-green-light)'
          : state === 'active'
            ? 'var(--mantine-color-teal-light)'
            : undefined,
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
            <Text component="span" size="sm" fw={600} truncate className="flex-1">
              {itemTitle}
            </Text>
            {!!unreadCount && (
              <Badge color="red" size="sm" className="shrink-0">
                {unreadCount}
              </Badge>
            )}
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

type Direction = 'all' | 'upcoming' | 'past';
type Role = '' | 'owner' | 'renter';

const MyBookingsPage = () => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { bookingId: bookingIdParam } = useParams<{ bookingId?: string }>();
  const updateBookingMutation = useUpdateBooking();
  const [endingId, setEndingId] = useState<string | null>(null);

  // ── selection (right-hand conversation panel) ─────────────────────────────
  // The URL is the single source of truth for which booking is selected, so
  // no local state (or effect to sync it) is needed.
  const selectedBookingId = bookingIdParam ?? null;

  // Pushed, not replaced, so the browser Back button leaves the conversation
  // the same way the mobile back button does.
  const handleSelectBooking = (id: string) => {
    navigate(`/bookings/${id}`);
  };

  // React Router stamps the initial history entry with key 'default', so a
  // non-default key means the selection was pushed by us and can be popped.
  // Deep links have nothing to pop and go to the list instead.
  const handleBack = () => {
    if (location.key !== 'default') {
      navigate(-1);
      return;
    }
    navigate('/bookings', { replace: true });
  };

  // ── controls ───────────────────────────────────────────────────────────────
  // Filters live in the URL (rather than local state) so the current view
  // survives a refresh and a shared link reproduces what was shared.
  const [searchParams, setSearchParams] = useSearchParams();

  const dirParam = searchParams.get('dir');
  // Defaults to 'all' so the page opens showing the full booking history
  // (like the start-page widget), rather than hiding anything not currently
  // ongoing/upcoming behind a filter the user has to discover.
  const direction: Direction = dirParam === 'past' || dirParam === 'upcoming' ? dirParam : 'all';
  const roleParam = searchParams.get('role');
  const role: Role = roleParam === 'owner' || roleParam === 'renter' ? roleParam : '';
  // Pending requests are surfaced by default so incoming/outstanding requests
  // aren't hidden behind an extra click.
  const showPending = searchParams.get('pending') !== '0';
  const pageSizeParam = searchParams.get('pageSize');
  const pageSize =
    pageSizeParam && PAGE_SIZE_OPTIONS.includes(pageSizeParam)
      ? Number(pageSizeParam)
      : DEFAULT_PAGE_SIZE;

  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') ?? '');
  const [debouncedSearch] = useDebouncedValue(searchInput.trim(), 300);
  const isSearching = debouncedSearch.length > 0;

  /** Apply a discrete filter change: pushes a new history entry (Back steps
   *  through filter changes, matching the rest of the app). */
  const updateFilters = (updates: Record<string, string | null>) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      return next;
    });
  };

  // The debounced search term is committed to the URL on its own, via
  // `replace` so every keystroke doesn't spam browser history.
  useEffect(() => {
    if ((searchParams.get('q') ?? '') === debouncedSearch) return;
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        if (debouncedSearch) next.set('q', debouncedSearch);
        else next.delete('q');
        return next;
      },
      { replace: true },
    );
    // Only debouncedSearch should trigger this — reading searchParams here is
    // just a guard against a redundant no-op update, not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const handleEndBooking = async (id: string) => {
    setEndingId(id);
    try {
      await updateBookingMutation.mutateAsync({
        id,
        data: { status: BOOKING_STATUS.completed, time_to: new Date().toISOString() },
      });
    } finally {
      setEndingId(null);
    }
  };

  // ── query ────────────────────────────────────────────────────────────────
  const statuses = useMemo(
    () =>
      showPending ? [String(BOOKING_STATUS.pending), ...APPROVED_STATUSES] : APPROVED_STATUSES,
    [showPending],
  );

  const queryParams = useMemo<Omit<BookingsFilterParams, 'page'>>(() => {
    const base: Omit<BookingsFilterParams, 'page'> = {
      page_size: pageSize,
      ...(role ? { role } : {}),
      // The status filter (approved/pending) only applies to the
      // current/past agenda views. The default 'all' view — and any active
      // search, which already claims to span "past, current & upcoming" —
      // intentionally leaves it off so every booking, including
      // cancelled/rejected ones, shows up.
      ...(!isSearching && direction !== 'all' ? { status: statuses } : {}),
    };
    // When searching we span the whole timeline (past, current & upcoming),
    // ordered newest-first so recent/upcoming matches surface at the top.
    if (isSearching) {
      return { ...base, search: debouncedSearch, ordering: '-time_from' };
    }
    // Default view: every booking, most recent conversation activity first
    // (same ordering as the start-page widget).
    if (direction === 'all') {
      return { ...base, ordering: '-latest_message_at' };
    }
    // Otherwise browse one direction of the agenda at a time.
    return {
      ...base,
      temporal: direction,
      ordering: direction === 'past' ? '-time_from' : 'time_from',
    };
  }, [statuses, pageSize, role, isSearching, debouncedSearch, direction]);

  const { data, isLoading, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useMyBookingsInfinite(queryParams);
  const bookings = useMemo(() => data?.pages.flatMap(page => page?.results ?? []) ?? [], [data]);

  const annotated = useMemo(
    () => bookings.map(b => ({ booking: b, state: getBookingState(b) })),
    [bookings],
  );

  // Auto-load the next batch once the list is scrolled to the bottom,
  // instead of exposing numbered pages.
  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    // Below `md` the fixed MobileBottomNav covers the last 4rem of the
    // viewport, so the page has to stop short of it or the message input ends
    // up underneath.
    <div className="container mx-auto p-4 h-[calc(100vh-8rem)] md:h-[calc(100vh-5rem)]">
      <div className="flex flex-col h-full">
        {/* Header — hidden on mobile once a conversation is open, where the
            panel's own back button takes over. */}
        <div
          className={cn(
            'flex items-center gap-2 mb-4 shrink-0',
            selectedBookingId && 'hidden md:flex',
          )}
        >
          <BackButton />
          <Title order={1} size="h3">
            {t('bookings.title')}
          </Title>
        </div>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 min-h-0">
          {/* Left column: filters + overview of all currently visible bookings */}
          <div
            className={cn(
              'flex-col min-h-0 md:col-span-1',
              selectedBookingId ? 'hidden md:flex' : 'flex',
            )}
          >
            {/* Controls */}
            <div className="flex flex-col gap-3 mb-3 shrink-0">
              <div className="flex flex-col gap-3">
                <TextInput
                  leftSection={<Search size={16} />}
                  placeholder={t('bookings.searchPlaceholder')}
                  aria-label={t('bookings.searchPlaceholder')}
                  value={searchInput}
                  onChange={e => setSearchInput(e.currentTarget.value)}
                />
                {/* Only meaningful once narrowed to current/past, where the
                    status filter is applied — in the default 'all' view, and
                    while searching (which also skips the status filter),
                    every status (including pending) is already shown. */}
                {!isSearching && direction !== 'all' && (
                  <Checkbox
                    checked={showPending}
                    onChange={e => updateFilters({ pending: e.currentTarget.checked ? null : '0' })}
                    label={t('bookings.showPending')}
                  />
                )}
              </div>

              <div className="flex flex-wrap gap-3 items-center justify-between">
                {!isSearching && (
                  <SegmentedControl
                    size="xs"
                    value={direction}
                    onChange={value => updateFilters({ dir: value === 'all' ? null : value })}
                    data={[
                      { label: t('bookings.directionAll'), value: 'all' },
                      { label: t('bookings.directionUpcoming'), value: 'upcoming' },
                      { label: t('bookings.directionPast'), value: 'past' },
                    ]}
                  />
                )}
                <SegmentedControl
                  size="xs"
                  value={role || 'all'}
                  onChange={value => updateFilters({ role: value === 'all' ? null : value })}
                  data={[
                    { label: t('bookings.filterAll'), value: 'all' },
                    { label: t('bookings.filterOwner'), value: 'owner' },
                    { label: t('bookings.filterRenter'), value: 'renter' },
                  ]}
                />
              </div>

              <Group gap="xs" wrap="nowrap" justify="flex-end">
                <Text size="xs" c="dimmed">
                  {t('bookings.perPage')}
                </Text>
                <Select
                  w={72}
                  size="xs"
                  value={String(pageSize)}
                  onChange={value =>
                    updateFilters({
                      pageSize: value && value !== String(DEFAULT_PAGE_SIZE) ? value : null,
                    })
                  }
                  data={PAGE_SIZE_OPTIONS}
                  allowDeselect={false}
                  aria-label={t('bookings.perPage')}
                />
              </Group>

              {isSearching && (
                <Text size="xs" c="dimmed">
                  {t('bookings.searchingAll')}
                </Text>
              )}
            </div>

            {/* List */}
            <Card withBorder padding={0} className="flex-1 min-h-0 flex flex-col">
              <ScrollArea className="flex-1" onBottomReached={handleBottomReached}>
                <div
                  className={cn(
                    'flex flex-col gap-2 p-2 transition-opacity',
                    isFetching && !isFetchingNextPage && 'opacity-60 pointer-events-none',
                  )}
                >
                  {isLoading ? (
                    <div className="flex items-center justify-center py-24">
                      <Text c="dimmed">{t('common.loading')}</Text>
                    </div>
                  ) : annotated.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3">
                      <Calendar
                        size={56}
                        color="var(--mantine-color-dimmed)"
                        className="opacity-40"
                      />
                      <Text c="dimmed">
                        {isSearching ? t('bookings.noSearchResults') : t('bookings.noBookings')}
                      </Text>
                    </div>
                  ) : (
                    <>
                      {annotated.map(({ booking, state }) => (
                        <BookingRow
                          key={booking.id}
                          booking={booking}
                          state={state}
                          t={t}
                          selected={selectedBookingId === booking.id}
                          onClick={handleSelectBooking}
                          onEnd={handleEndBooking}
                          isEnding={endingId === booking.id}
                          currentUsername={user?.username}
                        />
                      ))}
                      {isFetchingNextPage && (
                        <div className="flex items-center justify-center py-4">
                          <Loader size="sm" />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </ScrollArea>
            </Card>
          </div>

          {/* Right column: conversation details for the selected booking.
              `visibleFrom` rather than a Tailwind `hidden md:flex`: the Card
              root class sets `display: flex` unlayered and would win the
              cascade, showing the empty placeholder under the mobile list. */}
          <Card
            withBorder
            padding={0}
            visibleFrom={selectedBookingId ? undefined : 'md'}
            className="md:col-span-2 min-h-0 flex flex-col"
          >
            <BookingConversationPanel bookingId={selectedBookingId} onBack={handleBack} />
          </Card>
        </div>
      </div>
    </div>
  );
};

export default MyBookingsPage;
