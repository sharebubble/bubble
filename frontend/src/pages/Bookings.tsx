import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useMyBookings, useUpdateBooking } from '@/hooks/useBookings';
import { formatPrice } from '@/lib/currency';
import { cn } from '@/lib/utils';
import type { BookingList } from '@/services/django';
import { format, formatDuration, intervalToDuration, isAfter, isBefore, parseISO } from 'date-fns';
import { Calendar, ChevronLeft, ChevronRight, Clock, Package, Square, User } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

// ─── helpers ────────────────────────────────────────────────────────────────

const WINDOW_DAYS = 31;

const addDays = (date: Date, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

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
  const itemTitle = booking.item_details?.name ?? t('bookings.item');
  const itemImage = booking.item_details?.first_image;
  const userName = booking.user?.name || booking.user?.username || '—';
  const price = booking.item_details?.price;
  const currency = booking.item_details?.price_currency;

  const stateBadge =
    state === 'active' ? (
      <Badge className="bg-emerald-500 text-white text-xs shrink-0">{t('bookings.active')}</Badge>
    ) : state === 'upcoming' ? (
      <Badge variant="secondary" className="text-xs shrink-0">
        {t('bookings.upcoming')}
      </Badge>
    ) : (
      <Badge variant="outline" className="text-xs shrink-0">
        {t('bookings.past')}
      </Badge>
    );

  return (
    <Card
      className={cn(
        'transition-all cursor-pointer hover:bg-accent',
        state === 'past' && 'opacity-60',
      )}
      onClick={() => onClick(booking.id!)}
    >
      <CardContent className="p-3 flex gap-3 items-center">
        {/* Thumbnail */}
        <div className="w-12 h-12 rounded overflow-hidden bg-muted shrink-0">
          {itemImage ? (
            <img src={itemImage} alt={itemTitle} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Package className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-sm truncate">{itemTitle}</span>
            {stateBadge}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <User className="h-3 w-3 shrink-0" />
              {userName}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3 shrink-0" />
              {booking.time_from ? format(parseISO(booking.time_from), 'dd MMM yy, HH:mm') : '—'}
              {booking.time_to && <> → {format(parseISO(booking.time_to), 'dd MMM yy, HH:mm')}</>}
              {!booking.time_to && state === 'active' && (
                <span className="text-emerald-600 font-medium ml-1">{t('bookings.ongoing')}</span>
              )}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3 shrink-0" />
              {booking.time_from ? formatBookedDuration(booking.time_from, booking.time_to) : '—'}
            </span>
            {price && (
              <span className="font-medium text-foreground">
                {formatPrice(price, currency)}
                {booking.item_details?.sales_type === 'rent' && ' /h'}
              </span>
            )}
          </div>
        </div>

        {/* End booking button — only for active bookings owned by the current user */}
        {state === 'active' && isOwner && (
          <Button
            size="sm"
            variant="destructive"
            className="shrink-0 gap-1"
            disabled={isEnding}
            onClick={e => {
              e.stopPropagation();
              onEnd(booking.id!);
            }}
          >
            <Square className="h-3 w-3" />
            <span className="hidden sm:inline">{t('bookings.endBooking')}</span>
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

// ─── main page ───────────────────────────────────────────────────────────────

const MyBookingsPage = () => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const updateBookingMutation = useUpdateBooking();
  const [endingId, setEndingId] = useState<string | null>(null);

  const handleEndBooking = async (id: string) => {
    setEndingId(id);
    try {
      await updateBookingMutation.mutateAsync({
        id,
        data: { status: 4, time_to: new Date().toISOString() },
      });
    } finally {
      setEndingId(null);
    }
  };

  // ── window navigation ────────────────────────────────────────────────────
  // offset=0 → yesterday..today+30, offset=-1 → 31 days back, offset=+1 → 31 days forward
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);

  const { windowStart, windowEnd } = useMemo(() => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    const start = addDays(base, -1 + offset * WINDOW_DAYS);
    const end = addDays(base, 30 + offset * WINDOW_DAYS);
    return { windowStart: start, windowEnd: end };
  }, [offset]);

  const setOffset = (next: number) => {
    const params = new URLSearchParams(searchParams);
    if (next === 0) params.delete('offset');
    else params.set('offset', String(next));
    setSearchParams(params);
  };

  // ── role filter ──────────────────────────────────────────────────────────
  const role = (searchParams.get('role') ?? '') as '' | 'owner' | 'renter';

  const setRole = (r: '' | 'owner' | 'renter') => {
    const params = new URLSearchParams(searchParams);
    if (r) params.set('role', r);
    else params.delete('role');
    setSearchParams(params);
  };

  // ── query ────────────────────────────────────────────────────────────────
  const queryParams = useMemo(
    () => ({
      status: ['3', '4'],
      time_from_after: windowStart.toISOString(),
      time_from_before: windowEnd.toISOString(),
      ...(role ? { role } : {}),
      ordering: 'time_from',
    }),
    [windowStart, windowEnd, role],
  );

  const { data, isLoading } = useMyBookings(queryParams);
  const bookings = data?.results ?? [];

  const annotated = useMemo(
    () => bookings.map(b => ({ booking: b, state: getBookingState(b) })),
    [bookings],
  );

  const rangeLabel = `${format(windowStart, 'dd MMM yyyy')} – ${format(windowEnd, 'dd MMM yyyy')}`;

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-1">
        <h1 className="text-3xl font-bold">{t('bookings.title')}</h1>

        {/* Role filter */}
        <div className="flex items-center gap-2">
          {(['', 'owner', 'renter'] as const).map(r => (
            <Button
              key={r}
              size="sm"
              variant={role === r ? 'default' : 'outline'}
              onClick={() => setRole(r)}
              className="h-8"
            >
              {r === ''
                ? t('bookings.filterAll')
                : r === 'owner'
                  ? t('bookings.filterOwner')
                  : t('bookings.filterRenter')}
            </Button>
          ))}
        </div>
      </div>

      {/* Time window navigator */}
      <div className="flex items-center gap-2 mb-6">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => setOffset(offset - 1)}
          aria-label={t('bookings.prevPeriod')}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm text-muted-foreground">{rangeLabel}</span>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => setOffset(offset + 1)}
          aria-label={t('bookings.nextPeriod')}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        {offset !== 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => setOffset(0)}
          >
            {t('bookings.today')}
          </Button>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <p className="text-muted-foreground">{t('common.loading')}</p>
        </div>
      ) : annotated.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
          <Calendar className="h-14 w-14 opacity-40" />
          <p>{t('bookings.noBookings')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
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
    </div>
  );
};

export default MyBookingsPage;
