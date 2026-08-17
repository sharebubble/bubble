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
