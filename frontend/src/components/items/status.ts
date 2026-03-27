import { Status402Enum } from '@/services/django';

export const statusLabels: Record<Status402Enum, string> = {
  0: 'draft',
  1: 'processing',
  2: 'available',
  3: 'reserved',
  4: 'rented',
  5: 'sold',
};

export const statusColors: Record<Status402Enum, string> = {
  0: 'bg-muted text-muted-foreground',
  1: 'bg-warning text-warning-foreground',
  2: 'bg-success text-success-foreground',
  3: 'bg-secondary text-secondary-foreground',
  4: 'bg-destructive text-destructive-foreground',
  5: 'bg-destructive text-destructive-foreground',
};

export const getStatusLabel = (status?: Status402Enum | null) =>
  status === undefined || status === null ? undefined : statusLabels[status];

export const getStatusColor = (status?: Status402Enum | null) =>
  status === undefined || status === null ? undefined : statusColors[status];

export default {
  statusLabels,
  statusColors,
  getStatusLabel,
  getStatusColor,
};
