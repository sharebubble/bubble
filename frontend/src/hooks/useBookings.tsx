import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import {
  bookingsCreate,
  bookingsList,
  bookingsPartialUpdate,
  bookingsRetrieve,
  type BookingWritable,
  type PatchedBooking,
} from '@/services/django';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const useBookings = () => {
  return useQuery({
    queryKey: ['bookings'],
    queryFn: async () => {
      const response = await bookingsList();
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
      toast({
        title: t('common.error'),
        description: error?.non_field_errors[0] || t('booking.errorCreate'),
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
