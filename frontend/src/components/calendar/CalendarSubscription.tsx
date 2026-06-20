import { useLanguage } from '@/contexts/LanguageContext';
import { calendarAPI, type FeedLink, type PersonalCalendar } from '@/services/custom/calendar';
import {
  ActionIcon,
  Button,
  CopyButton,
  Group,
  Paper,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, Check, Copy, RefreshCw } from 'lucide-react';
import { notifications } from '@mantine/notifications';

type CalendarSubscriptionProps =
  | { kind: 'item'; id: string }
  | { kind: 'collection'; id: string }
  | { kind: 'user' };

/**
 * Owner-facing panel that surfaces, copies and rotates a calendar sharing link.
 *
 * - `item` / `collection`: a public, read-only iCalendar subscription URL.
 * - `user`: the caller's private read-write CalDAV URL.
 */
export function CalendarSubscription(props: CalendarSubscriptionProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const queryKey = ['calendar-link', props.kind, 'id' in props ? props.id : 'me'];

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: async () => {
      if (props.kind === 'item') return calendarAPI.getItemLink(props.id);
      if (props.kind === 'collection') return calendarAPI.getCollectionLink(props.id);
      return calendarAPI.getMyCalendar();
    },
  });

  const regenerate = useMutation({
    mutationFn: async () => {
      if (props.kind === 'item') return calendarAPI.regenerateItemLink(props.id);
      if (props.kind === 'collection') return calendarAPI.regenerateCollectionLink(props.id);
      return calendarAPI.regenerateMyCalendar();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      notifications.show({ message: t('calendar.regenerated') });
    },
  });

  const url =
    props.kind === 'user'
      ? (data as PersonalCalendar | undefined)?.caldav_url
      : (data as FeedLink | undefined)?.feed_url;
  const webcalUrl = props.kind === 'user' ? undefined : (data as FeedLink | undefined)?.webcal_url;

  const description =
    props.kind === 'item'
      ? t('calendar.item.description')
      : props.kind === 'collection'
        ? t('calendar.collection.description')
        : t('calendar.personal.description');

  const title = props.kind === 'user' ? t('calendar.personal.title') : t('calendar.title');

  return (
    <Paper withBorder p="md" radius="md">
      <Group gap="xs" mb="xs">
        <Calendar size={18} />
        <Title order={4}>{title}</Title>
      </Group>
      <Text size="sm" c="dimmed" mb="sm">
        {description}
      </Text>

      {isError && (
        <Text size="sm" c="red">
          {t('calendar.loadError')}
        </Text>
      )}

      {url && (
        <>
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <TextInput
              readOnly
              value={url}
              flex={1}
              styles={{ input: { fontFamily: 'monospace', fontSize: '0.8rem' } }}
              onFocus={e => e.currentTarget.select()}
            />
            <CopyButton value={url}>
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

          <Group justify="space-between" mt="sm">
            <Text size="xs" c="dimmed">
              {t('calendar.secretHint')}
            </Text>
            <Group gap="xs">
              {webcalUrl && (
                <Button
                  component="a"
                  href={webcalUrl}
                  variant="light"
                  size="xs"
                  leftSection={<Calendar size={14} />}
                >
                  {t('calendar.subscribe')}
                </Button>
              )}
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
            </Group>
          </Group>
        </>
      )}

      {isLoading && !url && (
        <Text size="sm" c="dimmed">
          …
        </Text>
      )}
    </Paper>
  );
}
