import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import {
  profilesMePartialUpdate,
  profilesMeRetrieve,
  type PatchedProfile,
  type Profile,
} from '@/services/django';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const useProfile = () => {
  const { user } = useAuth();

  return useQuery<Profile>({
    queryKey: ['profile', user?.username],
    queryFn: async () => {
      if (!user) throw new Error('User not authenticated');
      const response = await profilesMeRetrieve();
      return response.data;
    },
    enabled: !!user,
  });
};

export const useUpdateProfile = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (updates: PatchedProfile) => {
      if (!user) throw new Error('User not authenticated');
      const response = await profilesMePartialUpdate({ body: updates });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile', user?.username] });
      toast({
        title: 'Profile updated',
        description: 'Your profile has been successfully updated.',
      });
    },
    onError: error => {
      console.error('Error updating profile:', error);
      toast({
        title: 'Error',
        description: 'Failed to update profile. Please try again.',
        variant: 'destructive',
      });
    },
  });
};
