import { useLanguage } from '@/contexts/LanguageContext';
import { useCollectionHistory } from '@/hooks/useCollections';
import { Anchor, Badge, Divider, Modal, ScrollArea, Text } from '@mantine/core';
import { History, PackageMinus, PackagePlus } from 'lucide-react';
import { Link } from 'react-router-dom';

interface CollectionHistoryDialogProps {
  collectionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const CollectionHistoryDialog = ({
  collectionId,
  open,
  onOpenChange,
}: CollectionHistoryDialogProps) => {
  const { t } = useLanguage();
  const { data: events, isLoading } = useCollectionHistory(open ? collectionId : undefined);

  return (
    <Modal
      opened={open}
      onClose={() => onOpenChange(false)}
      size="lg"
      title={
        <span className="flex items-center gap-2 font-semibold">
          <History size={16} />
          {t('collections.history')}
        </span>
      }
    >
      {isLoading ? (
        <Text component="div" size="sm" c="dimmed" className="py-8 text-center">
          {t('common.loading')}
        </Text>
      ) : !events || events.length === 0 ? (
        <Text component="div" size="sm" c="dimmed" className="py-8 text-center">
          {t('collections.historyEmpty')}
        </Text>
      ) : (
        <ScrollArea.Autosize mah={420} className="pr-2">
          <div className="space-y-0">
            {events.map((event, index) => {
              const isAdded = event.action === 'item_added';
              const date = new Date(event.timestamp);
              const formattedDate = date.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              });
              const formattedTime = date.toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div key={event.id}>
                  <div className="flex items-start gap-3 py-3">
                    {/* Icon */}
                    <div
                      className={`mt-0.5 shrink-0 rounded-full p-1 ${
                        isAdded
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      }`}
                    >
                      {isAdded ? (
                        <PackagePlus className="h-3.5 w-3.5" />
                      ) : (
                        <PackageMinus className="h-3.5 w-3.5" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge color={isAdded ? 'green' : 'red'} size="sm">
                          {isAdded
                            ? t('collections.historyAdded')
                            : t('collections.historyRemoved')}
                        </Badge>
                        {/* Item name — linked if item still exists */}
                        {event.item_id ? (
                          <Anchor
                            component={Link}
                            to={`/item/${event.item_id}`}
                            size="sm"
                            fw={500}
                            onClick={() => onOpenChange(false)}
                          >
                            {event.item_name}
                          </Anchor>
                        ) : (
                          <Text component="span" size="sm" fw={500} c="dimmed" td="line-through">
                            {event.item_name}
                          </Text>
                        )}
                      </div>
                      <Text size="xs" c="dimmed" className="mt-0.5">
                        {t('collections.historyBy')} {event.actor ?? '—'} &middot; {formattedDate}{' '}
                        {formattedTime}
                      </Text>
                    </div>
                  </div>
                  {index < events.length - 1 && <Divider />}
                </div>
              );
            })}
          </div>
        </ScrollArea.Autosize>
      )}
    </Modal>
  );
};
