import { SalesTypeEnum, Status7D3Enum } from '@/services/django';

export const statusLabels: Record<Status7D3Enum, string> = {
  0: 'draft',
  2: 'available',
  3: 'reserved',
  4: 'rented',
  5: 'sold',
  6: 'archived',
};

// Mantine color names for Badge/indicator `color` props.
export const statusMantineColors: Record<Status7D3Enum, string> = {
  0: 'gray',
  2: 'green',
  3: 'yellow',
  4: 'red',
  5: 'red',
  6: 'gray',
};

// Statuses that retire an item from circulation. These are hidden from browse
// and collected under the archive tab of the owner's item list.
export const ARCHIVED_STATUSES: Status7D3Enum[] = [5, 6];
export const ACTIVE_STATUSES: Status7D3Enum[] = [0, 2, 3, 4];

export const isArchivedStatus = (status?: Status7D3Enum | null) =>
  status !== undefined && status !== null && ARCHIVED_STATUSES.includes(status);

export const getStatusLabel = (status?: Status7D3Enum | null) =>
  status === undefined || status === null ? undefined : statusLabels[status];

export const getStatusMantineColor = (status?: Status7D3Enum | null) =>
  status === undefined || status === null ? undefined : statusMantineColors[status];

export type SalesTypeBadgeProps = { color: string; variant: 'filled' | 'light' | 'outline' };

// Canonical sales-type badge styling shared across browse/detail/list views.
export const getSalesTypeBadgeProps = (st?: SalesTypeEnum | null): SalesTypeBadgeProps => {
  switch (st) {
    case 'sell':
      return { color: 'green', variant: 'filled' };
    case 'donate':
    case 'borrow':
      return { color: 'teal', variant: 'filled' };
    case 'rent':
      return { color: 'blue', variant: 'filled' };
    case 'want_buy':
    case 'want_rent':
      return { color: 'gray', variant: 'outline' };
    default:
      return { color: 'gray', variant: 'light' };
  }
};

export default {
  statusLabels,
  statusMantineColors,
  getStatusLabel,
  getStatusMantineColor,
};
