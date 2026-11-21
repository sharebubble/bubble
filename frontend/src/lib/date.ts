import { type Language } from '@/contexts/LanguageContext';
import { formatDuration, intervalToDuration, isAfter, parseISO } from 'date-fns';

const DATE_FORMATS: Record<Language, Intl.DateTimeFormatOptions & { locale: string }> = {
  en: { locale: 'en-CA', year: 'numeric', month: '2-digit', day: '2-digit' },
  de: { locale: 'de-DE', year: 'numeric', month: '2-digit', day: '2-digit' },
};

/**
 * Format a date value according to the app language.
 *   en → yyyy-mm-dd  (ISO-style, via en-CA locale)
 *   de → dd.mm.yyyy  (German convention)
 */
export const formatDate = (date: Date | string, language: Language): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  const { locale, ...options } = DATE_FORMATS[language];
  return new Intl.DateTimeFormat(locale, options).format(d);
};

/** Length of a booking: from `from` to `to`, or until `now` while it has no
 *  end date (an open-ended rental that is still running). */
export const formatBookedDuration = (
  from: string,
  to: string | null | undefined,
  now: Date = new Date(),
): string => {
  const start = parseISO(from);
  const end = to ? parseISO(to) : now;
  if (isAfter(start, end)) return '—';
  const duration = intervalToDuration({ start, end });
  return (
    formatDuration(duration, { format: ['days', 'hours', 'minutes'], delimiter: ' ' }) || '< 1 min'
  );
};
