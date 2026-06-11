import { StatusB0aEnum } from '@/services/django';

export const statusLabels: Record<StatusB0aEnum, string> = {
  0: 'draft',
  2: 'available',
  3: 'reserved',
  4: 'rented',
  5: 'sold',
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

export const getStatusMantineColor = (status?: StatusB0aEnum | null) =>
  status === undefined || status === null ? undefined : statusMantineColors[status];

export default {
  statusLabels,
  statusMantineColors,
  getStatusLabel,
  getStatusMantineColor,
};
