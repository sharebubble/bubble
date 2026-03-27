import { type Language } from '@/contexts/LanguageContext';

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
