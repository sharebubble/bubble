import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { commentsAPI, type CreateCommentInput, type ItemComment } from '@/services/custom/comments';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/** Fetch all comments for an item, newest first. */
export const useItemComments = (itemId: string | undefined, enabled = true) => {
  return useQuery<ItemComment[]>({
    queryKey: ['comments', itemId],
    enabled: !!itemId && enabled,
    queryFn: () => commentsAPI.listForItem(itemId!),
  });
};

/** Create a comment (with optional rating) and refresh the item's rating. */
export const useCreateComment = () => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateCommentInput) => commentsAPI.create(input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['comments', variables.item] });
      // The item's aggregate rating changes when a rated comment is added.
      queryClient.invalidateQueries({ queryKey: ['item', variables.item] });
      toast({ title: t('comments.added') });
    },
    onError: (error: unknown) => {
      console.error('Error creating comment:', error);
      toast({
        title: t('common.error'),
        description: t('comments.addError'),
        variant: 'destructive',
      });
    },
  });
};

/** Delete a comment and refresh the item's rating. */
export const useDeleteComment = (itemId: string | undefined) => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commentId: string) => commentsAPI.remove(commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', itemId] });
      queryClient.invalidateQueries({ queryKey: ['item', itemId] });
      toast({ title: t('comments.deleted') });
    },
    onError: (error: unknown) => {
      console.error('Error deleting comment:', error);
      toast({
        title: t('common.error'),
        description: t('comments.deleteError'),
        variant: 'destructive',
      });
    },
  });
};
