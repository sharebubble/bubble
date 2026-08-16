import { itemBookingsAPI, type ItemBookingHistoryEntry } from '@/services/custom/itemBookings';
import { useQuery } from '@tanstack/react-query';

/** Fetch the confirmed + completed booking history for an item. */
export const useItemBookingHistory = (itemId: string | undefined) => {
  return useQuery<ItemBookingHistoryEntry[]>({
    queryKey: ['item-booking-history', itemId],
    enabled: !!itemId,
    queryFn: () => itemBookingsAPI.listHistory(itemId!),
  });
};
