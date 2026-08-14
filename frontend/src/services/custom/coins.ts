/**
 * Community-coin valuations.
 *
 * Items handed over for free still have a value, so after such a transaction
 * the person who got the item can record what it was worth in community coins
 * (see backend `bubble.coins`). Those values form the public track record of
 * an item.
 *
 * These wrappers live here — rather than in the generated SDK — because the
 * SDK can only be regenerated against a live backend (`npm run types:openapi`);
 * a future regeneration will fold these operations into `src/services/django`
 * and this helper can be retired. They reuse the shared, pre-configured
 * `client`, so credentials, CSRF and the Accept-Language header are applied
 * exactly like every generated SDK call.
 */

import { client } from '../django/client.gen';

/** The person behind a valuation, as shown in a public track record. */
export interface CoinValuationUser {
  id: string;
  username: string;
  name: string;
}

/** One entry of an item's coin track record. */
export interface CoinValuation {
  id: string;
  booking: string;
  item: string;
  item_name: string;
  user: CoinValuationUser;
  /** Total value of the transaction, as a decimal string. */
  amount: string;
  /** Value per rental period; `null` for one-off transactions. */
  rate: string | null;
  /** Period the rate applies to (`h` | `d` | `w`), empty for sales. */
  rental_period: string;
  time_from: string | null;
  time_to: string | null;
  created_at: string;
  updated_at: string;
}

/** Aggregated coin track record of a single item. */
export interface CoinTrackRecordSummary {
  item: string;
  count: number;
  total: string;
  average: string | null;
}

/** The value a user last picked for an item, used to pre-fill the slider. */
export interface CoinValuationSuggestion {
  item: string;
  amount: string | null;
  rate: string | null;
  rental_period: string;
  has_previous: boolean;
}

/**
 * The parts of a booking the coin flow needs.
 *
 * `coin_valuation` and `coin_valuation_eligible` are served by the bookings
 * endpoints but are not in the generated `Booking` type yet (see the note at
 * the top of this file), so booking objects are narrowed to this shape where
 * the coin components consume them.
 */
export interface CoinValuationBooking {
  id: string;
  time_from?: string | null;
  time_to?: string | null;
  item_details?: {
    id: string;
    name?: string | null;
    sales_type?: string | null;
    rental_period?: string | null;
    price_currency?: string | null;
  } | null;
  /** Set once the booker has recorded what the transaction was worth. */
  coin_valuation?: CoinValuation | null;
  /** Whether this transaction can be valued in coins at all. */
  coin_valuation_eligible?: boolean;
}

interface PaginatedCoinValuations {
  count: number;
  next: string | null;
  previous: string | null;
  results: CoinValuation[];
}

/** What the user picked for one settled transaction. */
export interface CoinValuationInput {
  booking: string;
  /** Total value — used for one-off transactions (buying, donations). */
  amount?: string;
  /** Value per rental period — used for rentals. */
  rate?: string;
}

const EMPTY_PAGE: PaginatedCoinValuations = {
  count: 0,
  next: null,
  previous: null,
  results: [],
};

/** Fetch the coin track record of an item, newest entry first. */
export const fetchItemCoinValuations = async (
  itemId: string,
  pageSize = 20,
): Promise<PaginatedCoinValuations> => {
  const { data } = await client.get<{ 200: PaginatedCoinValuations }>({
    url: '/api/coin-valuations/',
    query: { item: itemId, page_size: pageSize },
  });
  return data ?? EMPTY_PAGE;
};

/** Fetch how many coins an item has collected in total and on average. */
export const fetchItemCoinSummary = async (itemId: string): Promise<CoinTrackRecordSummary> => {
  const { data } = await client.get<{ 200: CoinTrackRecordSummary }>({
    url: '/api/coin-valuations/summary/',
    query: { item: itemId },
  });
  return data ?? { item: itemId, count: 0, total: '0.00', average: null };
};

/** Fetch the value the current user last picked for this item, if any. */
export const fetchCoinValuationSuggestion = async (
  itemId: string,
): Promise<CoinValuationSuggestion> => {
  const { data } = await client.get<{ 200: CoinValuationSuggestion }>({
    url: '/api/coin-valuations/suggestion/',
    query: { item: itemId },
  });
  return data ?? { item: itemId, amount: null, rate: null, rental_period: '', has_previous: false };
};

/**
 * Record what a transaction was worth. Sending a value for a booking that
 * already has one replaces it, so this doubles as the edit call.
 */
export const saveCoinValuation = async (input: CoinValuationInput): Promise<CoinValuation> => {
  const { data } = await client.post<{ 201: CoinValuation }>({
    url: '/api/coin-valuations/',
    body: input,
  });
  return data as CoinValuation;
};
