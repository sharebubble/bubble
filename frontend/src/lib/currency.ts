// Currency utility functions

/**
 * Rental period values as used by the backend (`Item.rental_period`).
 * `h` = hourly, `d` = daily, `w` = weekly.
 */
export type RentalPeriod = 'h' | 'd' | 'w' | string | null | undefined;

/**
 * Map a rental period value to the i18n key for the price suffix.
 * Falls back to the hourly suffix for blank/unknown values.
 * @param rentalPeriod - The `rental_period` value from an item (`'h' | 'd' | 'w' | '' | null | undefined`)
 * @returns Translation key (e.g. 'time.perHour', 'time.perDay', 'time.perWeek')
 */
export function getRentalPeriodSuffixKey(rentalPeriod: RentalPeriod): string {
  switch (rentalPeriod) {
    case 'd':
      return 'time.perDay';
    case 'w':
      return 'time.perWeek';
    case 'h':
    default:
      return 'time.perHour';
  }
}

/**
 * Number of hours covered by one rental period.
 * The stored item price is the price for one period, so the hourly rate
 * is `price / getHoursPerRentalPeriod(rentalPeriod)`.
 * @param rentalPeriod - The `rental_period` value (`'h' | 'd' | 'w' | '' | null | undefined`)
 * @returns Hours per period (1, 24, or 168); defaults to 1 (hourly).
 */
export function getHoursPerRentalPeriod(rentalPeriod: RentalPeriod): number {
  switch (rentalPeriod) {
    case 'd':
      return 24;
    case 'w':
      return 168;
    case 'h':
    default:
      return 1;
  }
}

/**
 * Convert ISO 4217 currency code to symbol
 * @param currencyCode - Three-letter currency code (e.g., 'EUR', 'USD')
 * @returns Currency symbol (e.g., '€', '$')
 */
export function getCurrencySymbol(currencyCode: string | null | undefined): string {
  if (!currencyCode) return '€'; // Default to EUR

  const currencySymbols: Record<string, string> = {
    EUR: '€',
    USD: '$',
    GBP: '£',
    JPY: '¥',
    CNY: '¥',
    CHF: 'Fr',
    CAD: 'CA$',
    AUD: 'A$',
    NZD: 'NZ$',
    SEK: 'kr',
    NOK: 'kr',
    DKK: 'kr',
    PLN: 'zł',
    CZK: 'Kč',
    HUF: 'Ft',
    RON: 'lei',
    BGN: 'лв',
    HRK: 'kn',
    RUB: '₽',
    TRY: '₺',
    INR: '₹',
    BRL: 'R$',
    MXN: 'MX$',
    ZAR: 'R',
    KRW: '₩',
    SGD: 'S$',
    HKD: 'HK$',
    THB: '฿',
    IDR: 'Rp',
    MYR: 'RM',
    PHP: '₱',
    VND: '₫',
  };

  return currencySymbols[currencyCode.toUpperCase()] || currencyCode;
}

/**
 * Format price with currency symbol
 * @param price - Price value (string or number)
 * @param currencyCode - Three-letter currency code
 * @returns Formatted price string (e.g., '€10.00', '$25.50')
 */
export function formatPrice(
  price: string | number | null | undefined,
  currencyCode: string | null | undefined,
): string {
  if (price === undefined || price === null) return '';

  const numericPrice = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(numericPrice)) return '';

  const symbol = getCurrencySymbol(currencyCode);
  const formattedNumber = numericPrice.toFixed(2);

  // For currencies that typically go after the number
  const suffixCurrencies = ['CZK', 'PLN', 'HUF', 'RON', 'BGN', 'HRK', 'SEK', 'NOK', 'DKK'];
  if (currencyCode && suffixCurrencies.includes(currencyCode.toUpperCase())) {
    return `${formattedNumber} ${symbol}`;
  }

  return `${symbol} ${formattedNumber}`;
}

/**
 * Format price with currency for display (handles null/empty gracefully)
 * @param price - Price value
 * @param currencyCode - Three-letter currency code
 * @param placeholder - Text to show if price is empty (default: '')
 * @returns Formatted price or placeholder
 */
export function displayPrice(
  price: string | number | null | undefined,
  currencyCode: string | null | undefined,
  placeholder: string = '',
): string {
  const formatted = formatPrice(price, currencyCode);
  return formatted || placeholder;
}
