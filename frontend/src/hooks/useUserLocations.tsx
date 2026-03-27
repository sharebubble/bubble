import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

type UserLocation = {
  id: string;
  name: string;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  is_default?: boolean;
};

export const useUserLocations = () => {
  const { user } = useAuth();

  return useQuery<UserLocation[]>({
    queryKey: ['user-locations', user?.id],
    queryFn: async () => {
      if (!user) throw new Error('User not authenticated');

      // const { data, error } = await supabase
      //   .from("user_locations")
      //   .select("*")
      //   .eq("user_id", user.id)
      //   .order("created_at", { ascending: false });

      // if (error) throw error;
      // return data as UserLocation[];

      return [];
    },
    enabled: !!user,
  });
};

export const useCreateLocation = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (location: {
      name: string;
      address: string;
      latitude?: number;
      longitude?: number;
      is_default?: boolean;
    }) => {
      if (!user) throw new Error('User not authenticated');

      // const { error } = await supabase
      //   .from("user_locations")
      //   .insert({
      //     ...location,
      //     user_id: user.id,
      //   });

      // if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-locations', user?.id] });
      toast({
        title: 'Location added',
        description: 'Your location has been successfully added.',
      });
    },
    onError: error => {
      toast({
        title: 'Error',
        description: 'Failed to add location. Please try again.',
        variant: 'destructive',
      });
    },
  });
};

export const useUpdateLocation = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      locationId,
      updates,
    }: {
      locationId: string;
      updates: {
        name: string;
        address: string;
        latitude?: number;
        longitude?: number;
        is_default?: boolean;
      };
    }) => {
      // const { error } = await supabase
      //   .from("user_locations")
      //   .update(updates)
      //   .eq("id", locationId)
      //   .eq("user_id", user?.id);
      // if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-locations', user?.id] });
      toast({
        title: 'Location updated',
        description: 'Your location has been successfully updated.',
      });
    },
    onError: error => {
      toast({
        title: 'Error',
        description: 'Failed to update location. Please try again.',
        variant: 'destructive',
      });
    },
  });
};

export const useDeleteLocation = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (locationId: string) => {
      // const { error } = await supabase
      //   .from("user_locations")
      //   .delete()
      //   .eq("id", locationId)
      //   .eq("user_id", user?.id);
      // if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-locations', user?.id] });
      toast({
        title: 'Location deleted',
        description: 'Your location has been successfully deleted.',
      });
    },
    onError: error => {
      toast({
        title: 'Error',
        description: 'Failed to delete location. Please try again.',
        variant: 'destructive',
      });
    },
  });
};
