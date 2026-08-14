// Community-coin helpers.
//
// Items handed over for free (price blank or 0) are the ones that can be
// valued in community coins after the transaction — the rules here mirror
// `bubble.coins.models` on the backend.

import type { SalesTypeEnum } from '@/services/django';

/** Listing types where something actually changes hands. */
const VALUABLE_SALES_TYPES = ['sell', 'rent', 'donate', 'borrow'];

/** Listing types billed per rental period rather than as a lump sum. */
const RENTAL_SALES_TYPES = ['rent', 'borrow'];

/** Whether a listing is billed per rental period (hour / day / week). */
export const isCoinRentalSalesType = (salesType: SalesTypeEnum | string | null | undefined) =>
  RENTAL_SALES_TYPES.includes(String(salesType));

/**
 * Whether an item is on offer without a price, i.e. whether its transactions
 * can be valued in community coins.
 */
export const isFreeItem = (item: {
  sales_type?: SalesTypeEnum | string | null;
  price?: string | number | null;
}): boolean => {
  if (!VALUABLE_SALES_TYPES.includes(String(item.sales_type))) return false;
  if (item.price === null || item.price === undefined || item.price === '') return true;
  const numeric = typeof item.price === 'string' ? parseFloat(item.price) : item.price;
  return !isNaN(numeric) && numeric === 0;
};

/**
 * Format a coin amount for display: at most two decimals, without the
 * trailing zeros that make a track record hard to scan.
 */
export const formatCoins = (amount: string | number | null | undefined): string => {
  if (amount === null || amount === undefined || amount === '') return '0';
  const numeric = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(numeric)) return '0';
  return String(Math.round(numeric * 100) / 100);
};
