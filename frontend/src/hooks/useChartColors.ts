import { useComputedColorScheme } from '@mantine/core';

/**
 * Two validated categorical slots (blue, orange) with their own dark-mode
 * steps, plus a neutral. Red and green stay reserved for status (over budget,
 * owed/owing).
 */
const SERIES = {
  light: { first: '#2a78d6', second: '#eb6834', neutral: '#9a9893' },
  dark: { first: '#3987e5', second: '#d95926', neutral: '#6f6e69' },
};

export type SeriesSlot = keyof (typeof SERIES)['light'];

export const useChartColors = () => SERIES[useComputedColorScheme('light')];
