import type { BadgeProps } from '@mantine/core';

/** Booking status codes — mirror of the backend BookingStatus IntegerChoices. */
export const BOOKING_STATUS = {
  pending: 1,
  cancelled: 2,
  confirmed: 3,
  completed: 4,
  rejected: 5,
  inProgress: 6,
} as const;

// Statuses that mean a booking will never change again. Used to treat
// terminal sale-type bookings (which never set time_to) as "past" instead of
// deriving their temporal state purely from time_from/time_to.
export const TERMINAL_BOOKING_STATUSES: number[] = [
  BOOKING_STATUS.completed,
  BOOKING_STATUS.cancelled,
  BOOKING_STATUS.rejected,
];

type BookingTimes = {
  status?: number | null;
  time_from?: string | null;
  time_to?: string | null;
};

/** An approved rental without an end date that has already started (e.g. an
 *  instant rental by QR code). It runs until the item is returned, so it is
 *  ended with "Return" rather than cancelled. Mirrors the backend's
 *  ``is_open_ended_running``. */
export const isOpenEndedRunning = (booking: BookingTimes, now: Date = new Date()): boolean =>
  (booking.status === BOOKING_STATUS.confirmed || booking.status === BOOKING_STATUS.inProgress) &&
  !booking.time_to &&
  !!booking.time_from &&
  new Date(booking.time_from) <= now;

export type BookingStatusBadge = Pick<BadgeProps, 'color' | 'variant'> & {
  /** Translation key for the status label. */
  labelKey: string;
};

const BADGES: Record<number, BookingStatusBadge> = {
  [BOOKING_STATUS.pending]: {
    color: 'gray',
    variant: 'light',
    labelKey: 'requests.status.pending',
  },
  [BOOKING_STATUS.cancelled]: {
    color: 'gray',
    variant: 'outline',
    labelKey: 'requests.status.cancelled',
  },
  [BOOKING_STATUS.confirmed]: {
    color: 'green',
    variant: 'filled',
    labelKey: 'requests.status.confirmed',
  },
  [BOOKING_STATUS.completed]: {
    color: 'gray',
    variant: 'outline',
    labelKey: 'requests.status.completed',
  },
  [BOOKING_STATUS.rejected]: {
    color: 'red',
    variant: 'filled',
    labelKey: 'requests.status.rejected',
  },
  [BOOKING_STATUS.inProgress]: {
    color: 'teal',
    variant: 'filled',
    labelKey: 'requests.status.inProgress',
  },
};

const UNKNOWN: BookingStatusBadge = {
  color: 'gray',
  variant: 'light',
  labelKey: 'requests.status.unknown',
};

/** Badge colour, variant and label key for a booking status code. */
export const getBookingStatusBadge = (status?: number | null): BookingStatusBadge =>
  (status != null && BADGES[status]) || UNKNOWN;
