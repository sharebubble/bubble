import { useLanguage } from '@/contexts/LanguageContext';
import { calendarAPI, type FeedLink } from '@/services/custom/calendar';
import {
  ActionIcon,
  Button,
  CopyButton,
  Group,
  Popover,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, Check, Copy, RefreshCw } from 'lucide-react';
import { useState } from 'react';

interface CalendarSubscribeButtonProps {
  kind: 'item' | 'collection';
  id: string;
}

/**
 * Compact calendar icon (with tooltip) that opens a popover letting any
 * logged-in user copy / subscribe to the read-only iCalendar feed of an item
 * or collection. Owners additionally get a "Regenerate" action.
 */
export function CalendarSubscribeButton({ kind, id }: CalendarSubscribeButtonProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [opened, setOpened] = useState(false);

  const queryKey = ['calendar-link', kind, id];

  const { data, isLoading, isError } = useQuery({
    queryKey,
    // Only fetch once the user opens the popover — avoids a request per item.
    enabled: opened,
    queryFn: () =>
      kind === 'item' ? calendarAPI.getItemLink(id) : calendarAPI.getCollectionLink(id),
  });

  const regenerate = useMutation({
    mutationFn: () =>
      kind === 'item'
        ? calendarAPI.regenerateItemLink(id)
        : calendarAPI.regenerateCollectionLink(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      notifications.show({ message: t('calendar.regenerated') });
    },
  });

  const link = data as FeedLink | undefined;

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={340}
      position="bottom-end"
      withArrow
      shadow="md"
      trapFocus
    >
      <Popover.Target>
        <Tooltip label={t('calendar.subscribeTooltip')}>
          <ActionIcon
            variant="light"
            size="lg"
            aria-label={t('calendar.subscribeTooltip')}
            onClick={() => setOpened(o => !o)}
          >
            <Calendar size={18} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>

      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            {t('calendar.title')}
          </Text>
          <Text size="xs" c="dimmed">
            {kind === 'item'
              ? t('calendar.item.description')
              : t('calendar.collection.description')}
          </Text>

          {isLoading && (
            <Text size="sm" c="dimmed">
              …
            </Text>
          )}

          {isError && (
            <Text size="sm" c="red">
              {t('calendar.loadError')}
            </Text>
          )}

          {link && (
            <>
              <Group gap="xs" align="flex-end" wrap="nowrap">
                <TextInput
                  readOnly
                  value={link.feed_url}
                  flex={1}
                  size="xs"
                  styles={{ input: { fontFamily: 'monospace', fontSize: '0.75rem' } }}
                  onFocus={e => e.currentTarget.select()}
                />
                <CopyButton value={link.feed_url}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? t('calendar.copied') : t('calendar.copy')}>
                      <ActionIcon
                        variant={copied ? 'filled' : 'light'}
                        color={copied ? 'green' : undefined}
                        size="lg"
                        onClick={() => {
                          copy();
                          notifications.show({ message: t('calendar.copied') });
                        }}
                      >
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </CopyButton>
              </Group>

              <Group justify="space-between" gap="xs">
                <Button
                  component="a"
                  href={link.webcal_url}
                  variant="light"
                  size="xs"
                  leftSection={<Calendar size={14} />}
                >
                  {t('calendar.subscribe')}
                </Button>
                {link.can_manage && (
                  <Button
                    variant="subtle"
                    size="xs"
                    color="red"
                    leftSection={<RefreshCw size={14} />}
                    loading={regenerate.isPending}
                    onClick={() => {
                      if (window.confirm(t('calendar.regenerateConfirm'))) {
                        regenerate.mutate();
                      }
                    }}
                  >
                    {t('calendar.regenerate')}
                  </Button>
                )}
              </Group>
            </>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
