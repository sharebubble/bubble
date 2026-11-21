/** Canonical path of the item catalogue (browse + search + filters).
 *
 * The catalogue lives at its own route rather than on "/" so that the browse
 * state is expressed by real URL params alone — no sentinel param is needed to
 * distinguish "browsing" from the mobile start page, and every catalogue URL is
 * shareable and reproducible on any device.
 */
export const BROWSE_PATH = '/browse';

/** Account hub: the mobile entry point to the user-owned areas of the app. */
export const ACCOUNT_PATH = '/account';

/** The viewer's favorite items, reachable from the profile menu. */
export const FAVORITES_PATH = '/favorites';

/** The community ledger: every transaction, visible to every member. */
export const LEDGER_PATH = '/ledger';

/** The signed-in member's own ledger account and statement. */
export const MY_LEDGER_PATH = '/ledger/me';

export const ledgerTransactionPath = (id: string) => `${LEDGER_PATH}/t/${id}`;

export const ledgerAccountPath = (id: string) => `${LEDGER_PATH}/a/${id}`;

export const ledgerCostSharePath = (id: string) => `${LEDGER_PATH}/splits/${id}`;

export const LEDGER_STATS_PATH = `${LEDGER_PATH}/stats`;

export const LEDGER_REPORT_PATH = `${LEDGER_PATH}/report`;

export const LEDGER_MANAGE_PATH = `${LEDGER_PATH}/manage`;
/** Tamper evidence: the hash chain and the published digests. */
export const LEDGER_CHAIN_PATH = `${LEDGER_PATH}/chain`;
/** The treasurer's bank statement import. */
export const LEDGER_BANK_PATH = `${LEDGER_PATH}/bank`;

export const MY_STATEMENT_PATH = `${MY_LEDGER_PATH}/statement`;

export const ledgerStatementPath = (accountId: string) => `${LEDGER_PATH}/a/${accountId}/statement`;

const ITEM_PATH_PATTERN =
  /^\/item\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/quick-rent)?\/?$/i;

/** In-app path of a scanned bubble item QR code (quick-rent sheet or plain
 *  item link), or null when the code isn't one. The host is ignored so codes
 *  printed with another bubble URL (e.g. before a domain change) still work. */
export const itemPathFromScan = (raw: string): string | null => {
  try {
    const { pathname } = new URL(raw.trim());
    return ITEM_PATH_PATTERN.test(pathname) ? pathname.replace(/\/$/, '') : null;
  } catch {
    return null;
  }
};
