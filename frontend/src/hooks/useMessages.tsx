import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import {
  messagesCreate,
  messagesList,
  messagesPartialUpdate,
  type MessageWritable,
} from '@/services/django';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const useMessages = (bookingUuid?: string) => {
  const query = useQuery({
    queryKey: ['messages', bookingUuid],
    queryFn: async () => {
      if (!bookingUuid) throw new Error('Booking UUID is required');
      const response = await messagesList({
        query: { booking: bookingUuid },
      });
      return response.data;
    },
    enabled: !!bookingUuid,
  });

  return query;
};

export const useCreateMessage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: MessageWritable) => {
      const response = await messagesCreate({ body: data });
      return response.data;
    },
    onSuccess: data => {
      // Invalidate messages for this booking
      queryClient.invalidateQueries({ queryKey: ['messages', data.booking] });
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Failed to send message',
        description: error?.message || 'Failed to send message. Please try again.',
      });
    },
  });
};

export const useMarkMessageAsRead = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (messageUuid: string) => {
      const response = await messagesPartialUpdate({
        path: { id: messageUuid },
        body: { is_read: true },
      });
      return response.data;
    },
    onSuccess: data => {
      // Invalidate messages for this booking to refresh the list
      queryClient.invalidateQueries({ queryKey: ['messages', data.booking] });
      // Also invalidate bookings to update unread count
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      // Also invalidate unread messages count
      queryClient.invalidateQueries({ queryKey: ['unread-messages'] });
    },
    onError: (error: Error) => {
      console.error('Failed to mark message as read:', error);
    },
  });
};

export const useUnreadMessages = () => {
  const { user, loading: authLoading } = useAuth();

  const query = useQuery({
    queryKey: ['unread-messages'],
    queryFn: async () => {
      const response = await messagesList({
        query: { unread_received: true },
      });
      return response.data;
    },
    // Only enable when auth finished loading and we have a user
    enabled: !authLoading && !!user,
    // Refetch every 300 seconds to keep count updated
    refetchInterval: 300000,
  });

  return query;
};
