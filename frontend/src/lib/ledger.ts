import type {
  Booking,
  LedgerCategory,
  LedgerCostShare,
  LedgerCostShareStateEnum,
  LedgerMyAccount,
  LedgerParticipantResponseEnum,
  LedgerTransaction,
} from '@/services/django';

/**
 * Transfer categories (top-up, payout, between members) only repeat the kind,
 * so the category badge is shown for income and expense categories alone.
 */
export const hasOwnCategory = (transaction: LedgerTransaction) =>
  !!transaction.category && transaction.category.kind !== 'transfer';

/**
 * The seeded categories carry English names; show the translated name for
 * those, and the stored name for categories the treasurer added or renamed.
 */
export const categoryLabel = (
  category: Pick<LedgerCategory, 'code' | 'name'> & { has_default_name?: boolean },
  t: (key: string) => string,
) => {
  if (category.has_default_name === false) return category.name;
  const key = `ledger.categoryName.${category.code}`;
  const translated = t(key);
  return translated === key ? category.name : translated;
};

/** An accepted sale under the ledger rules (D17/D18): the item already changed hands. */
export const isAcceptedSale = (booking: Booking) => !!booking.seller && !!booking.sale_accepted_at;

export type FieldErrors = Partial<Record<string, string>>;

/** The API answers a rejected write with `{field: [message]}` or `{detail}`. */
export const fieldErrors = (error: unknown): FieldErrors => {
  if (!error || typeof error !== 'object') return {};
  return Object.fromEntries(
    Object.entries(error as Record<string, unknown>).map(([field, messages]) => [
      field === 'detail' ? 'non_field_errors' : field,
      Array.isArray(messages) ? String(messages[0]) : String(messages),
    ]),
  );
};

/** The first error message of a rejected write, or `fallback`. */
export const firstError = (error: unknown, fallback: string) =>
  Object.values(fieldErrors(error))[0] ?? fallback;

/**
 * Split `total` by `weights` into whole cents that add up exactly, like the
 * server's largest-remainder rule; used to preview a split before saving.
 */
export const allocateCents = (total: number, weights: number[]): number[] => {
  const cents = Math.round(total * 100);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || cents <= 0) return weights.map(() => 0);
  const exact = weights.map(w => (cents * w) / sum);
  const floored = exact.map(Math.floor);
  let left = cents - floored.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, index) => ({ index, rest: value - floored[index] }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    floored[index] += 1;
    left -= 1;
  }
  return floored.map(c => c / 100);
};

/** The receipt formats the server accepts (it sniffs the content too). */
export const RECEIPT_TYPES = 'application/pdf,image/jpeg,image/png,image/webp,image/heic';

/** Today as `yyyy-mm-dd` in local time, for date inputs. */
export const today = () => new Date().toLocaleDateString('en-CA');

export const COST_SHARE_STATE_COLORS: Record<LedgerCostShareStateEnum, string> = {
  open: 'orange',
  posted: 'green',
  cancelled: 'gray',
};

export const RESPONSE_COLORS: Record<LedgerParticipantResponseEnum, string> = {
  pending: 'orange',
  accepted: 'green',
  objected: 'red',
};

/** The viewer's share of a split, if they take part. */
export const myShare = (costShare: LedgerCostShare, me?: LedgerMyAccount) =>
  costShare.is_payer
    ? costShare.payer_share
    : costShare.participants.find(p => p.account.id === me?.id)?.share;

export type PeriodPreset = 'this-year' | 'last-year' | 'last-12-months' | 'all';

const isoDate = (date: Date) => date.toLocaleDateString('en-CA');

/** Date bounds of a period preset, in local time; `all` has none. */
export const periodRange = (
  preset: PeriodPreset,
  now = new Date(),
): { date_from?: string; date_to?: string } => {
  const year = now.getFullYear();
  switch (preset) {
    case 'this-year':
      return { date_from: `${year}-01-01`, date_to: `${year}-12-31` };
    case 'last-year':
      return { date_from: `${year - 1}-01-01`, date_to: `${year - 1}-12-31` };
    case 'last-12-months': {
      const start = new Date(year, now.getMonth() - 11, 1);
      return { date_from: isoDate(start), date_to: isoDate(now) };
    }
    default:
      return {};
  }
};

/** The label of a statistics row: seeded names are translated by code. */
export const statsRowLabel = (
  row: { code: string; label: string; translatable: boolean },
  groupBy: string,
  t: (key: string) => string,
) => {
  if (!row.translatable) return row.label;
  const key = groupBy === 'kind' ? `ledger.kind.${row.code}` : `ledger.categoryName.${row.code}`;
  const translated = t(key);
  return translated === key ? row.label : translated;
};

/** Years to offer in statement and report pickers, newest first. */
export const recentYears = (count = 6, now = new Date()) =>
  Array.from({ length: count }, (_, index) => now.getFullYear() - index);
