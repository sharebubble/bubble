import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import {
  useAllCollections,
  useAddItemToCollection,
  useRemoveItemFromCollection,
  useCreateCollection,
  useItemCollections,
} from '@/hooks/useCollections';
import { cn } from '@/lib/utils';
import { BookMarked, Check, Plus } from 'lucide-react';
import { useState } from 'react';

interface AddToCollectionPopoverProps {
  itemId: string;
  /** When true, shows only the icon with a tooltip and no label text. */
  iconOnly?: boolean;
  /** Optional extra className for the trigger button */
  className?: string;
}

/**
 * A popover button that lets the logged-in user add or remove the given item
 * from any of their collections, or create a new collection on the fly.
 */
export const AddToCollectionPopover = ({
  itemId,
  iconOnly = false,
  className,
}: AddToCollectionPopoverProps) => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { data: allCollections, isLoading } = useAllCollections({ enabled: !!user });
  const collections = (allCollections ?? []).filter(col => col.can_add_items);
  const addMutation = useAddItemToCollection();
  const removeMutation = useRemoveItemFromCollection();
  const createMutation = useCreateCollection();
  const { data: itemCollections } = useItemCollections(user ? itemId : undefined);
  const itemCollectionIds = new Set((itemCollections ?? []).map(c => c.id));

  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  if (!user) return null;

  const collectionContainsItem = (collectionId: string) => itemCollectionIds.has(collectionId);

  const handleToggle = (collectionId: string, alreadyIn: boolean) => {
    if (alreadyIn) {
      removeMutation.mutate({ collectionId, itemId });
    } else {
      addMutation.mutate({ collectionId, itemId });
    }
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    createMutation.mutate(
      { name: newName.trim() },
      {
        onSuccess: created => {
          if (created?.id) {
            addMutation.mutate({ collectionId: created.id, itemId });
          }
          setNewName('');
          setShowCreate(false);
        },
      },
    );
  };

  const isBusy = addMutation.isPending || removeMutation.isPending || createMutation.isPending;

  const popover = (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size={iconOnly ? 'icon' : 'sm'}
          className={cn(iconOnly ? 'h-8 w-8 shrink-0' : 'gap-2', className)}
          onClick={e => e.stopPropagation()}
        >
          <BookMarked className="h-4 w-4" />
          {!iconOnly && t('collections.addToCollection')}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-64 p-3 space-y-2" align="end" onClick={e => e.stopPropagation()}>
        <p className="text-sm font-medium">{t('collections.myCollections')}</p>

        {isLoading && <p className="text-xs text-muted-foreground">{t('common.loading')}</p>}

        {!isLoading && (!collections || collections.length === 0) && (
          <p className="text-xs text-muted-foreground">{t('collections.noCollections')}</p>
        )}

        <div className="space-y-1 max-h-48 overflow-y-auto">
          {(collections ?? []).map(col => {
            const alreadyIn = collectionContainsItem(col.id);
            return (
              <button
                key={col.id}
                type="button"
                disabled={isBusy}
                onClick={() => handleToggle(col.id, alreadyIn)}
                className={cn(
                  'w-full flex items-center justify-between text-left text-sm px-2 py-1.5 rounded hover:bg-muted transition-colors',
                  alreadyIn && 'text-primary font-medium',
                )}
              >
                <span className="truncate">{col.name}</span>
                {alreadyIn && <Check className="h-3 w-3 shrink-0 ml-1" />}
              </button>
            );
          })}
        </div>

        {/* Create new collection inline */}
        {showCreate ? (
          <div className="flex gap-1 pt-1">
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder={t('collections.namePlaceholder')}
              className="h-7 text-sm flex-1"
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') setShowCreate(false);
              }}
              autoFocus
              disabled={isBusy}
            />
            <Button
              size="sm"
              className="h-7 px-2"
              onClick={handleCreate}
              disabled={isBusy || !newName.trim()}
            >
              <Check className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
            onClick={() => setShowCreate(true)}
          >
            <Plus className="h-3 w-3" />
            {t('collections.newCollection')}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );

  if (!iconOnly) return popover;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{popover}</TooltipTrigger>
        <TooltipContent side="top">
          <p>{t('collections.addToCollection')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
