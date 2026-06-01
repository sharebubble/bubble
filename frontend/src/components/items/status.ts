import { StatusB0aEnum } from '@/services/django';

export const statusLabels: Record<StatusB0aEnum, string> = {
  0: 'draft',
  2: 'available',
  3: 'reserved',
  4: 'rented',
  5: 'sold',
};

export const statusColors: Record<StatusB0aEnum, string> = {
  0: 'bg-muted text-muted-foreground',
  2: 'bg-success text-success-foreground',
  3: 'bg-secondary text-secondary-foreground',
  4: 'bg-destructive text-destructive-foreground',
  5: 'bg-destructive text-destructive-foreground',
};

export const getStatusLabel = (status?: StatusB0aEnum | null) =>
  status === undefined || status === null ? undefined : statusLabels[status];

export const getStatusColor = (status?: StatusB0aEnum | null) =>
  status === undefined || status === null ? undefined : statusColors[status];

export default {
  statusLabels,
  statusColors,
  getStatusLabel,
  getStatusColor,
};
