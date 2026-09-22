import type { LedgerCategory, LedgerTransaction } from '@/services/django';

/**
 * Transfer categories (top-up, payout, between members) only repeat the kind,
 * so the category badge is shown for income and expense categories alone.
 */
export const hasOwnCategory = (transaction: LedgerTransaction) =>
  !!transaction.category && transaction.category.kind !== 'transfer';

/**
 * The seeded categories carry English names; show the translated name for
 * those, and the stored name for categories the treasurer added.
 */
export const categoryLabel = (category: LedgerCategory, t: (key: string) => string) => {
  const key = `ledger.categoryName.${category.code}`;
  const translated = t(key);
  return translated === key ? category.name : translated;
};
