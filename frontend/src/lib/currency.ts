// Currency utility functions

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
