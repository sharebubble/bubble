import { client } from '../django/client.gen';

/**
 * A single historical booking for an item. Contains only booking information
 * (status, duration, prices) — never any message/conversation data. `booker`
 * is null for anonymous viewers.
 */
export interface ItemBookingHistoryEntry {
  id: string;
  status: number;
  status_display: string;
  time_from: string | null;
  time_to: string | null;
  official_price: string | null;
  official_price_currency: string;
  amount_paid: string | null;
  amount_paid_currency: string;
  offer: string | null;
  counter_offer: string | null;
  rental_price: string | null;
  booker: string | null;
  created_at: string;
}

/**
 * Hand-written client for the item booking-history endpoint (mirrors the
 * `services/custom/images.ts` pattern) until the OpenAPI SDK is regenerated.
 */
class ItemBookingsAPI {
  private async request<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${client.getConfig().baseUrl}${endpoint}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /** Confirmed + completed bookings for an item, newest first. */
  async listHistory(itemId: string): Promise<ItemBookingHistoryEntry[]> {
    const data = await this.request<ItemBookingHistoryEntry[]>(
      `/api/public-items/${encodeURIComponent(itemId)}/booking-history/`,
    );
    return Array.isArray(data) ? data : [];
  }
}

export const itemBookingsAPI = new ItemBookingsAPI();
