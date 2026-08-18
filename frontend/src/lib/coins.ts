// Community-coin helpers.
//
// Two distinct features share this "coins" vocabulary:
// - A free item (price blank or 0) can be valued in coins after the fact —
//   a voluntary, per-transaction judgement call (see CoinValuationDialog).
// - Any sell/rent item can instead be *listed* with its price denominated in
//   coins rather than money — a binding term the owner picks up front (the
//   item's `price_unit`). The rules mirror `bubble.coins`/`bubble.items`
//   models on the backend.

import type { SalesTypeEnum } from '@/services/django';
import { formatPrice } from './currency';

/** What an item's `price` is denominated in. Mirrors `PricingUnit` on the backend. */
export type PriceUnit = 'money' | 'coin';

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

/** Whether an item's price is denominated in community coins rather than money. */
export const isCoinPriced = (priceUnit: PriceUnit | string | null | undefined): boolean =>
  priceUnit === 'coin';

/**
 * The pricing fields of an item, wherever they're needed for display. A
 * structural subset of the generated `Item`/`ItemList`/`ItemMinimal` types —
 * those are passed in directly — plus `price_unit`, which isn't in the
 * generated SDK yet (see the note at the top of services/custom/coins.ts).
 */
export interface ItemPricing {
  price?: string | number | null;
  price_currency?: string | null;
  price_unit?: PriceUnit | string | null;
}

/**
 * Format an item's price for display, in whichever unit the owner chose:
 * the default currency, or a plain "{amount} {coin.shortName}" for
 * coin-priced listings.
 */
export const formatItemPrice = (item: ItemPricing, coinShortName: string): string =>
  isCoinPriced(item.price_unit)
    ? `${formatCoins(item.price)} ${coinShortName}`
    : formatPrice(item.price, item.price_currency);
