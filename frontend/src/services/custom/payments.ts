import { getCSRFToken } from '@/lib/utils';
import { client } from '../django/client.gen';

/**
 * One payment recorded against a booking.
 *
 * Recording is bookkeeping, not processing: no money moves through the
 * platform, members simply note down what they settled between themselves.
 * `voluntary` marks the free-item case, where the amount was the payer's own
 * choice rather than a price that had been agreed up front.
 */
export interface BookingPayment {
  id: string;
  booking: string;
  item: string | null;
  item_name: string;
  payer: { id: string; username: string; name: string } | null;
  amount: string | null;
  currency: string;
  voluntary: boolean;
  time_from: string | null;
  time_to: string | null;
  created_at: string;
}

/** What an item has been paid across all of its bookings. */
export interface ItemPaymentSummary {
  item: string;
  count: number;
  total: string;
  average: string | null;
  currency: string;
}

/** What to pre-fill the payment form with for one booking. */
export interface PaymentSuggestion {
  booking: string;
  amount: string | null;
  currency: string;
  /** True when a price had been agreed; false when the amount is a free choice. */
  agreed: boolean;
  /** True when the amount is what this member paid for the item last time. */
  from_previous: boolean;
}

/** A member's own running balance, derived from their postings. */
export interface AccountBalance {
  balance: string;
  currency: string;
  paid_out: string;
  received: string;
}

interface PaginatedPayments {
  count: number;
  next: string | null;
  previous: string | null;
  results: BookingPayment[];
}

export interface RecordPaymentInput {
  booking: string;
  amount: string;
}

/**
 * Hand-written client for the ledger's payment endpoints.
 *
 * The generated SDK in `src/services/django` is produced from the backend
 * OpenAPI schema against a live server; until that regenerates, this thin
 * wrapper mirrors the pattern used by `services/custom/comments.ts`.
 */
class PaymentsAPI {
  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const headers: HeadersInit = { ...options?.headers };

    const method = options?.method?.toUpperCase();
    if (method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const csrfToken = getCSRFToken();
      if (csrfToken) {
        headers['X-CSRFToken'] = csrfToken;
      }
    }

    const response = await fetch(`${client.getConfig().baseUrl}${endpoint}`, {
      credentials: 'include',
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    if (response.status === 204) {
      return Promise.resolve(undefined as T);
    }

    return response.json();
  }

  /**
   * Every standing payment recorded against an item, newest first.
   *
   * The endpoint is paginated, so follow the `next` links — a partial list
   * would understate an item's record.
   */
  async listForItem(itemId: string): Promise<BookingPayment[]> {
    const all: BookingPayment[] = [];
    let endpoint: string | null = `/api/payments/?item=${encodeURIComponent(itemId)}`;

    while (endpoint) {
      const page: PaginatedPayments = await this.request<PaginatedPayments>(endpoint);
      all.push(...(page.results ?? []));
      endpoint = page.next ? new URL(page.next).pathname + new URL(page.next).search : null;
    }

    return all;
  }

  async summaryForItem(itemId: string): Promise<ItemPaymentSummary> {
    return this.request<ItemPaymentSummary>(
      `/api/payments/summary/?item=${encodeURIComponent(itemId)}`,
    );
  }

  async suggestionForBooking(bookingId: string): Promise<PaymentSuggestion> {
    return this.request<PaymentSuggestion>(
      `/api/payments/suggestion/?booking=${encodeURIComponent(bookingId)}`,
    );
  }

  async myBalance(): Promise<AccountBalance> {
    return this.request<AccountBalance>('/api/payments/balance/');
  }

  /**
   * Record what was paid for a booking.
   *
   * Recording again corrects the previous figure rather than adding a second
   * one — the backend reverses the old entry and posts the new one.
   */
  async record(input: RecordPaymentInput): Promise<BookingPayment> {
    return this.request<BookingPayment>('/api/payments/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }
}

export const paymentsAPI = new PaymentsAPI();

/**
 * The payment fields the bookings endpoint serves alongside each booking.
 *
 * They are not in the generated `Booking` type yet (see the note above), so
 * components widen the generated type with this one.
 */
export interface BookingWithPayment {
  id: string;
  /** The standing payment, or null when nothing has been recorded. */
  payment: BookingPayment | null;
  /** True once the booking has completed and a payment may be recorded. */
  payment_recordable: boolean;
}
