import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import {
  paymentsAPI,
  type AccountBalance,
  type BookingPayment,
  type ItemPaymentSummary,
  type PaymentSuggestion,
  type RecordPaymentInput,
} from '@/services/custom/payments';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/** Every payment recorded against an item — its public track record. */
export const useItemPayments = (itemId: string | undefined, enabled = true) => {
  return useQuery<BookingPayment[]>({
    queryKey: ['payments', 'item', itemId],
    enabled: !!itemId && enabled,
    queryFn: () => paymentsAPI.listForItem(itemId!),
  });
};

/** What an item has been paid in total and on average. */
export const useItemPaymentSummary = (itemId: string | undefined, enabled = true) => {
  return useQuery<ItemPaymentSummary>({
    queryKey: ['payments', 'summary', itemId],
    enabled: !!itemId && enabled,
    queryFn: () => paymentsAPI.summaryForItem(itemId!),
  });
};

/**
 * What to pre-fill the payment form with.
 *
 * For a priced booking this is the amount that was agreed; for a free one it
 * is whatever this member paid for the same item last time, or null on a
 * first borrow.
 */
export const usePaymentSuggestion = (bookingId: string | undefined, enabled = true) => {
  return useQuery<PaymentSuggestion>({
    queryKey: ['payments', 'suggestion', bookingId],
    enabled: !!bookingId && enabled,
    queryFn: () => paymentsAPI.suggestionForBooking(bookingId!),
    // The suggestion only moves when a payment is recorded, and that
    // invalidates it explicitly.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
};

/** The signed-in member's own running balance. */
export const useMyBalance = (enabled = true) => {
  return useQuery<AccountBalance>({
    queryKey: ['payments', 'balance'],
    enabled,
    queryFn: () => paymentsAPI.myBalance(),
    retry: false,
  });
};

/**
 * Record what was paid for a booking.
 *
 * Recording again corrects the standing figure rather than adding a second
 * one, so the booking, the item's record and the member's balance all need
 * refreshing afterwards.
 */
export const useRecordPayment = (itemId?: string) => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: RecordPaymentInput) => paymentsAPI.record(input),
    onSuccess: payment => {
      const item = itemId ?? payment.item ?? undefined;
      queryClient.invalidateQueries({ queryKey: ['payments', 'item', item] });
      queryClient.invalidateQueries({ queryKey: ['payments', 'summary', item] });
      queryClient.invalidateQueries({ queryKey: ['payments', 'suggestion'] });
      queryClient.invalidateQueries({ queryKey: ['payments', 'balance'] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      toast({ title: t('payments.saved') });
    },
    onError: (error: unknown) => {
      console.error('Error recording payment:', error);
      toast({
        title: t('common.error'),
        description: t('payments.saveFailed'),
        variant: 'destructive',
      });
    },
  });
};
