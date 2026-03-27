import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCollectionHistory } from '@/hooks/useCollections';
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            {t('collections.history')}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t('common.loading')}
          </div>
        ) : !events || events.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t('collections.historyEmpty')}
          </div>
        ) : (
          <ScrollArea className="max-h-[420px] pr-2">
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
                          <Badge
                            variant={isAdded ? 'default' : 'destructive'}
                            className="text-xs px-1.5 py-0"
                          >
                            {isAdded
                              ? t('collections.historyAdded')
                              : t('collections.historyRemoved')}
                          </Badge>
                          {/* Item name — linked if item still exists */}
                          {event.item_id ? (
                            <Button
                              asChild
                              variant="link"
                              className="h-auto p-0 text-sm font-medium"
                              onClick={() => onOpenChange(false)}
                            >
                              <Link to={`/item/${event.item_id}`}>{event.item_name}</Link>
                            </Button>
                          ) : (
                            <span className="text-sm font-medium text-muted-foreground line-through">
                              {event.item_name}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t('collections.historyBy')} {event.actor ?? '—'} &middot; {formattedDate}{' '}
                          {formattedTime}
                        </p>
                      </div>
                    </div>
                    {index < events.length - 1 && <Separator />}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
};
