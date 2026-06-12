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
import { ActionIcon, Button, Popover, Text, TextInput, Tooltip } from '@mantine/core';
import { BookMarked, Check, Loader2, Plus } from 'lucide-react';
import { useState, type MouseEvent } from 'react';

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

  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const { data: allCollections, isLoading } = useAllCollections({ enabled: !!user && open });
  const collections = (allCollections ?? []).filter(col => col.can_add_items);
  const addMutation = useAddItemToCollection();
  const removeMutation = useRemoveItemFromCollection();
  const createMutation = useCreateCollection();
  const { data: itemCollections, isLoading: isLoadingItemCollections } = useItemCollections(
    user && open ? itemId : undefined,
  );
  const itemCollectionIds = new Set((itemCollections ?? []).map(c => c.id));

  if (!user) return null;

  const collectionContainsItem = (collectionId: string) => itemCollectionIds.has(collectionId);
  const isLoadingCollections = isLoading || isLoadingItemCollections;

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

  const handleTriggerClick = (e: MouseEvent) => {
    e.stopPropagation();
    setOpen(o => !o);
  };

  const trigger = iconOnly ? (
    <ActionIcon
      variant="default"
      size="md"
      className={cn('shrink-0', className)}
      onClick={handleTriggerClick}
      aria-label={t('collections.addToCollection')}
    >
      <BookMarked size={16} />
    </ActionIcon>
  ) : (
    <Button
      variant="outline"
      size="sm"
      className={className}
      leftSection={<BookMarked size={16} />}
      onClick={handleTriggerClick}
    >
      {t('collections.addToCollection')}
    </Button>
  );

  return (
    <Popover opened={open} onChange={setOpen} position="bottom-end" width={260} shadow="md">
      <Popover.Target>
        {iconOnly ? (
          <Tooltip label={t('collections.addToCollection')} position="top">
            {trigger}
          </Tooltip>
        ) : (
          trigger
        )}
      </Popover.Target>

      <Popover.Dropdown className="space-y-2" p="sm" onClick={e => e.stopPropagation()}>
        <Text size="sm" fw={500}>
          {t('collections.myCollections')}
        </Text>

        {isLoadingCollections && (
          <div className="flex items-center justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoadingCollections && (!collections || collections.length === 0) && (
          <Text size="xs" c="dimmed">
            {t('collections.noCollections')}
          </Text>
        )}

        <div className="space-y-1 max-h-48 overflow-y-auto">
          {(collections ?? []).map(col => {
            const alreadyIn = collectionContainsItem(col.id);
            return (
              <Button
                key={col.id}
                variant="subtle"
                color={alreadyIn ? 'green' : 'gray'}
                size="compact-sm"
                fullWidth
                justify="space-between"
                disabled={isBusy}
                rightSection={alreadyIn ? <Check size={12} className="shrink-0" /> : undefined}
                onClick={() => handleToggle(col.id, alreadyIn)}
              >
                <span className="truncate">{col.name}</span>
              </Button>
            );
          })}
        </div>

        {/* Create new collection inline */}
        {showCreate ? (
          <div className="flex gap-1 pt-1">
            <TextInput
              size="xs"
              className="flex-1"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder={t('collections.namePlaceholder')}
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') setShowCreate(false);
              }}
              autoFocus
              disabled={isBusy}
            />
            <ActionIcon
              size="input-xs"
              onClick={handleCreate}
              disabled={isBusy || !newName.trim()}
              aria-label={t('collections.newCollection')}
            >
              <Check size={12} />
            </ActionIcon>
          </div>
        ) : (
          <Button
            variant="subtle"
            color="gray"
            size="compact-sm"
            fullWidth
            justify="flex-start"
            leftSection={<Plus size={12} />}
            onClick={() => setShowCreate(true)}
          >
            {t('collections.newCollection')}
          </Button>
        )}
      </Popover.Dropdown>
    </Popover>
  );
};
