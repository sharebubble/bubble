import { useAuth } from '@/hooks/useAuth';
import {
  notificationPreferencesMePartialUpdate,
  notificationPreferencesMeRetrieve,
  type NotificationPreferenceMe,
  type PatchedNotificationPreferenceMe,
} from '@/services/django';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const useNotificationPreferences = () => {
  const { user } = useAuth();

  return useQuery<NotificationPreferenceMe>({
    queryKey: ['notification-preferences', user?.username],
    queryFn: async () => {
      if (!user) throw new Error('User not authenticated');
      const response = await notificationPreferencesMeRetrieve();
      return response.data;
    },
    enabled: !!user,
  });
};

export const useUpdateNotificationPreferences = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (updates: PatchedNotificationPreferenceMe) => {
      if (!user) throw new Error('User not authenticated');
      const response = await notificationPreferencesMePartialUpdate({ body: updates });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['notification-preferences', user?.username],
      });
    },
    onError: error => {
      console.error('Error updating notification preferences:', error);
    },
  });
};
