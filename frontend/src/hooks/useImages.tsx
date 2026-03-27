import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { imagesAPI } from '@/services/custom/images';

import {
  imagesDestroy,
  imagesList,
  imagesPartialUpdate,
  type Image,
  type PatchedImage,
} from '@/services/django';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const useItemImages = (itemUuid?: string) => {
  return useQuery({
    queryKey: ['item-images', itemUuid],
    queryFn: async () => {
      if (!itemUuid) throw new Error('Item UUID is required');
      // Get all images and filter by item on the client side
      // Note: This could be optimized with a backend endpoint that filters by item
      const response = await imagesList();
      return response.data.results.filter(img => img.item === itemUuid);
    },
    enabled: !!itemUuid,
  });
};

export const useCreateImage = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation<Image, Error, { item: string; original: File | string; ordering?: number }>({
    mutationFn: async (data: { item: string; original: File | string; ordering?: number }) => {
      if (!user) throw new Error('User not authenticated');
      const response = await imagesAPI.createImage(data);
      return response;
    },
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: ['item-images', data.item] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['my-items', user?.id] });
      toast({
        title: 'Image Uploaded',
        description: 'Your image has been successfully uploaded.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error Uploading Image',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useUpdateImage = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation<Image, Error, { imageId: string; data: PatchedImage }>({
    mutationFn: async ({ imageId, data }: { imageId: string; data: PatchedImage }) => {
      if (!user) throw new Error('User not authenticated');
      const response = await imagesPartialUpdate({
        path: { id: imageId },
        body: data,
      });
      return response.data;
    },
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: ['item-images', data.item] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      toast({
        title: 'Image Updated',
        description: 'Your image has been successfully updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error Updating Image',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useDeleteImage = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation<void, Error, { imageId: string; itemUuid: string }>({
    mutationFn: async ({ imageId }: { imageId: string; itemUuid: string }) => {
      if (!user) throw new Error('User not authenticated');
      await imagesDestroy({
        path: { id: imageId },
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['item-images', variables.itemUuid],
      });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      toast({
        title: 'Image Deleted',
        description: 'The image has been successfully deleted.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error Deleting Image',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
