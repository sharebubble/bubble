import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useCreateComment, useDeleteComment, useItemComments } from '@/hooks/useComments';
import {
  ActionIcon,
  Avatar,
  Button,
  Divider,
  Group,
  Modal,
  Rating,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { formatDistanceToNow } from 'date-fns';
import { MessageSquare, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';

interface ItemCommentsProps {
  itemId: string;
  /** Id of the item owner — owners may moderate (delete) any comment. */
  ownerId?: string;
  averageRating?: number | null;
  ratingCount?: number;
  commentCount?: number;
}

/**
 * Shows an item's aggregate star rating inline and exposes the full list of
 * user comments/reviews in a popup. Registered users can add their own comment
 * with an optional star rating from within the popup.
 */
export const ItemComments = ({
  itemId,
  ownerId,
  averageRating,
  ratingCount = 0,
  commentCount = 0,
}: ItemCommentsProps) => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [opened, { open, close }] = useDisclosure(false);

  const { data: comments, isLoading } = useItemComments(itemId, opened);
  const createComment = useCreateComment();
  const deleteComment = useDeleteComment(itemId);

  const [body, setBody] = useState('');
  const [rating, setRating] = useState(0);

  const handleSubmit = () => {
    if (!body.trim()) return;
    createComment.mutate(
      { item: itemId, body: body.trim(), rating: rating > 0 ? rating : null },
      {
        onSuccess: () => {
          setBody('');
          setRating(0);
        },
      },
    );
  };

  const hasRating = typeof averageRating === 'number' && ratingCount > 0;

  return (
    <div className="space-y-2">
      {/* Inline rating summary — always visible on the item */}
      <Group gap="xs" align="center">
        {hasRating ? (
          <>
            <Rating value={averageRating ?? 0} fractions={10} readOnly size="sm" />
            <Text size="sm" fw={600}>
              {averageRating?.toFixed(1)}
            </Text>
            <Text size="sm" c="dimmed">
              ({t('comments.ratingCount').replace('{count}', String(ratingCount))})
            </Text>
          </>
        ) : (
          <Group gap={4} align="center">
            <Star size={16} color="var(--mantine-color-dimmed)" />
            <Text size="sm" c="dimmed">
              {t('comments.noRatings')}
            </Text>
          </Group>
        )}
      </Group>

      <Button
        variant="subtle"
        size="compact-sm"
        leftSection={<MessageSquare size={16} />}
        onClick={open}
        px={0}
      >
        {t('comments.seeComments').replace('{count}', String(commentCount))}
      </Button>

      <Modal opened={opened} onClose={close} title={t('comments.title')} size="lg" centered>
        <Stack gap="md">
          {/* Aggregate summary inside the popup */}
          {hasRating && (
            <Group gap="xs" align="center">
              <Rating value={averageRating ?? 0} fractions={10} readOnly />
              <Text fw={600}>{averageRating?.toFixed(1)}</Text>
              <Text c="dimmed" size="sm">
                {t('comments.ratingCount').replace('{count}', String(ratingCount))}
              </Text>
            </Group>
          )}

          {/* Add-comment form for logged-in users */}
          {user ? (
            <Stack gap="xs">
              <Text size="sm" fw={500}>
                {t('comments.addTitle')}
              </Text>
              <Group gap="xs" align="center">
                <Text size="sm" c="dimmed">
                  {t('comments.yourRating')}
                </Text>
                <Rating value={rating} onChange={setRating} />
              </Group>
              <Textarea
                placeholder={t('comments.placeholder')}
                value={body}
                onChange={event => setBody(event.currentTarget.value)}
                autosize
                minRows={2}
                maxRows={6}
              />
              <Group justify="flex-end">
                <Button
                  onClick={handleSubmit}
                  loading={createComment.isPending}
                  disabled={!body.trim()}
                >
                  {t('comments.submit')}
                </Button>
              </Group>
            </Stack>
          ) : (
            <Text size="sm" c="dimmed">
              {t('comments.loginToComment')}
            </Text>
          )}

          <Divider />

          {/* Comment list */}
          {isLoading ? (
            <Text size="sm" c="dimmed">
              {t('common.loading')}
            </Text>
          ) : comments && comments.length > 0 ? (
            <ScrollArea.Autosize mah={360}>
              <Stack gap="md">
                {comments.map(comment => {
                  const canDelete = !!user && (user.id === comment.user.id || user.id === ownerId);
                  return (
                    <div key={comment.id} className="space-y-1">
                      <Group justify="space-between" align="flex-start" wrap="nowrap">
                        <Group gap="xs" align="center">
                          <Avatar
                            radius="xl"
                            size="sm"
                            color="initials"
                            name={comment.user.name || comment.user.username}
                          >
                            {(comment.user.name || comment.user.username || '?')
                              .charAt(0)
                              .toUpperCase()}
                          </Avatar>
                          <div>
                            <Text size="sm" fw={500}>
                              {comment.user.name || comment.user.username}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {formatDistanceToNow(new Date(comment.created_at), {
                                addSuffix: true,
                              })}
                            </Text>
                          </div>
                        </Group>
                        {canDelete && (
                          <Tooltip label={t('common.delete')}>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              size="sm"
                              aria-label={t('common.delete')}
                              loading={deleteComment.isPending}
                              onClick={() => deleteComment.mutate(comment.id)}
                            >
                              <Trash2 size={14} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </Group>
                      {comment.rating ? <Rating value={comment.rating} readOnly size="xs" /> : null}
                      <Text size="sm" style={{ whiteSpace: 'pre-line' }}>
                        {comment.body}
                      </Text>
                    </div>
                  );
                })}
              </Stack>
            </ScrollArea.Autosize>
          ) : (
            <Text size="sm" c="dimmed">
              {t('comments.empty')}
            </Text>
          )}
        </Stack>
      </Modal>
    </div>
  );
};
