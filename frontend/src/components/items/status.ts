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

// Mantine color names for Badge/indicator `color` props.
export const statusMantineColors: Record<StatusB0aEnum, string> = {
  0: 'gray',
  2: 'green',
  3: 'yellow',
  4: 'red',
  5: 'red',
};

export const getStatusLabel = (status?: StatusB0aEnum | null) =>
  status === undefined || status === null ? undefined : statusLabels[status];

export const getStatusColor = (status?: StatusB0aEnum | null) =>
  status === undefined || status === null ? undefined : statusColors[status];

export const getStatusMantineColor = (status?: StatusB0aEnum | null) =>
  status === undefined || status === null ? undefined : statusMantineColors[status];

export default {
  statusLabels,
  statusColors,
  statusMantineColors,
  getStatusLabel,
  getStatusColor,
  getStatusMantineColor,
};
