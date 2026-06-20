import { CalendarSubscribeButton } from '@/components/calendar/CalendarSubscribeButton';
import { CollectionHistoryDialog } from '@/components/collections/CollectionHistoryDialog';
import { CollectionPermissionsPanel } from '@/components/collections/CollectionPermissionsPanel';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import {
  useCollection,
  useUpdateCollection,
  useRemoveItemFromCollection,
} from '@/hooks/useCollections';
import { getCategoryIcon } from '@/lib/categoryIcons';
import { formatPrice } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import {
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  Tabs,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { ArrowLeft, BookMarked, Edit3, History, ShoppingCart, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

const CollectionDetail = () => {
  const { collectionId } = useParams<{ collectionId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const updateMutation = useUpdateCollection();
  const removeMutation = useRemoveItemFromCollection();

  const { data: collection, isLoading, error } = useCollection(collectionId);

  const [showEdit, setShowEdit] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const isOwner = user && collection && user.username === collection.owner;
  const canRemoveItems = isOwner || !!collection?.can_remove_items;

  const openEdit = () => {
    if (!collection) return;
    setEditName(collection.name);
    setEditSlug(collection.slug ?? '');
    setEditDescription(collection.description ?? '');
    setShowEdit(true);
  };

  const handleSave = async () => {
    if (!collection || !editName.trim()) return;
    await updateMutation.mutateAsync({
      id: collection.id,
      name: editName.trim(),
      slug: editSlug.trim() || undefined,
      description: editDescription.trim() || undefined,
    });
    setShowEdit(false);
  };

  const confirmRemove = (itemId: string) => {
    if (!collectionId) return;
    modals.openConfirmModal({
      title: t('collections.removeFromCollection'),
      children: <Text size="sm">{t('collections.confirmDelete')}</Text>,
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => removeMutation.mutate({ collectionId, itemId }),
    });
  };

  if (isLoading) {
    return (
      <Text component="div" c="dimmed" className="container mx-auto px-4 py-8 text-center">
        {t('common.loading')}
      </Text>
    );
  }

  if (error || !collection) {
    return (
      <div className="container mx-auto px-4 py-8 text-center">
        <Text c="red">{error?.message ?? 'Collection not found.'}</Text>
        <Button component={Link} to="/collections" className="mt-4">
          {t('collections.backToCollections')}
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8 space-y-6">
      {/* Back button */}
      <Button
        variant="subtle"
        leftSection={<ArrowLeft size={16} />}
        onClick={() => navigate('/collections')}
      >
        {t('collections.backToCollections')}
      </Button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <BookMarked className="h-6 w-6 text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold truncate">{collection.name}</h1>
            {collection.description && (
              <Text size="sm" c="dimmed" className="mt-1">
                {collection.description}
              </Text>
            )}
            <Text component="div" size="xs" c="dimmed" className="flex items-center gap-3 mt-2">
              <span>
                {t('collections.owner')}: <span className="font-medium">{collection.owner}</span>
              </span>
              <span>
                {t('collections.created')}: {formatDate(collection.created_at, language)}
              </span>
              <Badge variant="light">
                {t('collections.itemCount').replace('{count}', collection.items_count)}
              </Badge>
            </Text>
          </div>
        </div>

        {isOwner && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            leftSection={<Edit3 size={16} />}
            onClick={openEdit}
          >
            {t('collections.editCollection')}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          leftSection={<History size={16} />}
          onClick={() => setShowHistory(true)}
        >
          {t('collections.historyButton')}
        </Button>
        {/* Calendar subscription — any logged-in user who can view the collection */}
        {user && collectionId && <CalendarSubscribeButton kind="collection" id={collectionId} />}
      </div>

      <Divider />

      {/* Items grid */}
      {collection.collection_items.length === 0 ? (
        <Text component="div" c="dimmed" className="text-center py-16">
          <ShoppingCart className="mx-auto h-12 w-12 mb-4 opacity-40" />
          <p>{t('collections.noItems')}</p>
        </Text>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {collection.collection_items.map(ci => {
            const item = ci.item;
            return (
              <Card
                key={ci.id}
                withBorder
                padding={0}
                className="group overflow-hidden cursor-pointer transition-all duration-200 hover:shadow-strong hover:scale-105"
                onClick={() => navigate(`/item/${item.id}`)}
              >
                {/* Image */}
                <div className="relative aspect-4/3 overflow-hidden bg-muted">
                  {item.first_image ? (
                    <img
                      src={item.first_image}
                      alt={item.name}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                    />
                  ) : (
                    (() => {
                      const CategoryIcon = getCategoryIcon(
                        (item as { category?: string }).category,
                      );
                      return (
                        <div className="flex h-full w-full items-center justify-center">
                          <CategoryIcon className="h-16 w-16 text-muted-foreground/50" />
                        </div>
                      );
                    })()
                  )}
                  {item.sales_type && (
                    <div className="absolute top-2 right-2">
                      <Badge size="sm">{t(`item.salesType.badge.${item.sales_type}`)}</Badge>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-3 space-y-1">
                  <h3 className="font-semibold text-sm line-clamp-1 group-hover:text-primary transition-colors">
                    {item.name}
                  </h3>
                  {item.price && (
                    <p className="text-sm font-medium">
                      {formatPrice(item.price, item.price_currency)}
                    </p>
                  )}
                  {ci.note && (
                    <Text size="xs" c="dimmed" lineClamp={2}>
                      {ci.note}
                    </Text>
                  )}
                </div>

                {/* Remove button (owner or editor) */}
                {canRemoveItems && (
                  <div className="px-3 pb-3" onClick={e => e.stopPropagation()}>
                    <Button
                      variant="subtle"
                      color="red"
                      size="sm"
                      fullWidth
                      leftSection={<Trash2 size={12} />}
                      onClick={e => {
                        e.stopPropagation();
                        confirmRemove(item.id);
                      }}
                    >
                      {t('collections.removeFromCollection')}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* History dialog */}
      {collectionId && (
        <CollectionHistoryDialog
          collectionId={collectionId}
          open={showHistory}
          onOpenChange={setShowHistory}
        />
      )}

      {/* Edit dialog — tabbed: Details + Permissions (owner only) */}
      <Modal
        opened={showEdit}
        onClose={() => setShowEdit(false)}
        title={t('collections.editCollection')}
        size="lg"
      >
        <Tabs defaultValue="details">
          <Tabs.List grow>
            <Tabs.Tab value="details">{t('collections.detailsTab')}</Tabs.Tab>
            <Tabs.Tab value="permissions">{t('collections.permissionsTab')}</Tabs.Tab>
          </Tabs.List>

          {/* Details tab */}
          <Tabs.Panel value="details" className="space-y-4 pt-4">
            <TextInput
              label={t('collections.name')}
              value={editName}
              onChange={e => setEditName(e.target.value)}
              placeholder={t('collections.namePlaceholder')}
              data-autofocus
            />
            <TextInput
              label={t('collections.slug')}
              value={editSlug}
              onChange={e => setEditSlug(e.target.value)}
              placeholder={t('collections.slugPlaceholder')}
              description={t('collections.slugHelp')}
            />
            <Textarea
              label={t('collections.description')}
              value={editDescription}
              onChange={e => setEditDescription(e.target.value)}
              placeholder={t('collections.descriptionPlaceholder')}
              rows={3}
            />
            <Group justify="flex-end">
              <Button variant="outline" onClick={() => setShowEdit(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleSave} disabled={!editName.trim() || updateMutation.isPending}>
                {updateMutation.isPending ? t('common.saving') : t('collections.saveChanges')}
              </Button>
            </Group>
          </Tabs.Panel>

          {/* Permissions tab */}
          <Tabs.Panel value="permissions" className="pt-4">
            {collectionId && (
              <CollectionPermissionsPanel
                collectionId={collectionId}
                ownerUsername={collection?.owner}
              />
            )}
          </Tabs.Panel>
        </Tabs>
      </Modal>
    </div>
  );
};

export default CollectionDetail;
