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
