import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import {
  bookingsConfirmReceivedCreate,
  bookingsConfirmReturnedCreate,
  bookingsCreate,
  bookingsList,
  bookingsPartialUpdate,
  bookingsRetrieve,
  type BookingWritable,
  type PatchedBooking,
} from '@/services/django';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// Extended filter params not yet reflected in the auto-generated BookingsListData type
// (the authenticated BookingViewSet queryset fails schema introspection for anonymous users)
export type BookingsFilterParams = {
  status?: string[];
  role?: 'owner' | 'renter';
  temporal?: 'upcoming' | 'active' | 'past';
  search?: string;
  time_from_after?: string;
  time_from_before?: string;
  time_to_after?: string;
  time_to_before?: string;
  time_to_isnull?: boolean;
  ordering?: string;
  page?: number;
  page_size?: number;
};

export const useBookings = () => {
  return useQuery({
    queryKey: ['bookings'],
    queryFn: async () => {
      const response = await bookingsList();
      return response.data;
    },
  });
};

export const useMyBookings = (params: BookingsFilterParams = {}) => {
  return useQuery({
    queryKey: ['bookings', 'filtered', params],
    queryFn: async () => {
      // Cast query to any to pass extra filter params not yet in the generated type
      const response = await bookingsList({ query: params as any });
      return response.data;
    },
  });
};

export const useBooking = (id?: string) => {
  return useQuery({
    queryKey: ['bookings', id],
    queryFn: async () => {
      if (!id) throw new Error('Booking UUID is required');
      const response = await bookingsRetrieve({ path: { id } });
      return response.data;
    },
    enabled: !!id,
  });
};

export const useCreateBooking = () => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: BookingWritable) => {
      const response = await bookingsCreate({ body: data });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      toast({
        title: t('booking.successTitle'),
        description: t('booking.successCreated'),
      });
    },
    onError: (error: any) => {
      console.error('Error creating booking:', error);
      const description =
        error?.non_field_errors?.[0] ||
        error?.detail ||
        (typeof error === 'string' ? error : null) ||
        t('booking.errorCreate');
      toast({
        title: t('common.error'),
        description,
        variant: 'destructive',
      });
    },
  });
};

export const useUpdateBooking = () => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: PatchedBooking }) => {
      const response = await bookingsPartialUpdate({
        path: { id },
        body: data,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      toast({
        title: t('booking.successTitle'),
        description: t('booking.successUpdated'),
      });
    },
    onError: (error: any) => {
      console.error('Error updating booking:', error);
      toast({
        title: t('common.error'),
        description: JSON.stringify(error) || t('booking.errorUpdate'),
        variant: 'destructive',
      });
    },
  });
};

const useFulfillmentMutation = (
  action: typeof bookingsConfirmReceivedCreate | typeof bookingsConfirmReturnedCreate,
  successKey: string,
) => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await action({ path: { id } });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item'] });
      toast({
        title: t('booking.successTitle'),
        description: t(successKey),
      });
    },
    onError: (error: unknown) => {
      console.error('Error confirming fulfillment:', error);
      const err = error as { non_field_errors?: string[]; detail?: string } | string | null;
      const description =
        (typeof err === 'string'
          ? err
          : (err?.non_field_errors?.[0] ?? err?.detail)) || t('booking.errorUpdate');
      toast({
        title: t('common.error'),
        description,
        variant: 'destructive',
      });
    },
  });
};

/** Booker confirms they received the item (starts a rental or completes a sale). */
export const useConfirmReceived = () =>
  useFulfillmentMutation(bookingsConfirmReceivedCreate, 'booking.successReceived');

/** Owner confirms a rented item was returned, completing the rental. */
export const useConfirmReturned = () =>
  useFulfillmentMutation(bookingsConfirmReturnedCreate, 'booking.successReturned');
