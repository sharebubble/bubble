/**
 * An item's optional minimum rental duration is stored in hours
 * (`rental_min_hours`); owners enter it as hours, days or weeks.
 */

export type DurationUnit = 'h' | 'd' | 'w';

export const HOURS_PER_UNIT: Record<DurationUnit, number> = { h: 1, d: 24, w: 24 * 7 };

/** The largest unit that divides `hours` evenly: 48 → days, 336 → weeks, 36 → hours. */
export function unitForHours(hours: number): DurationUnit {
  if (hours % HOURS_PER_UNIT.w === 0) return 'w';
  if (hours % HOURS_PER_UNIT.d === 0) return 'd';
  return 'h';
}

/** "1 day", "36 hours", "2 weeks" — mirrors the backend's `format_hours`. */
export function formatDuration(
  hours: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const unit = unitForHours(hours);
  const count = hours / HOURS_PER_UNIT[unit];
  const noun = { h: 'hour', d: 'day', w: 'week' }[unit];
  return t(`duration.${noun}${count === 1 ? '' : 's'}`, { count });
}

/** Hours between two YYYY-MM-DDTHH:mm strings (or Dates); 0 when either is missing. */
export function hoursBetween(from: string | Date | null, to: string | Date | null): number {
  if (!from || !to) return 0;
  return (new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60);
}
