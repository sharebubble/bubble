import { CollectionHistoryDialog } from '@/components/collections/CollectionHistoryDialog';
import { CollectionPermissionsPanel } from '@/components/collections/CollectionPermissionsPanel';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
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
import { ArrowLeft, BookMarked, Edit3, History, Trash2 } from 'lucide-react';
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
  const [editDescription, setEditDescription] = useState('');
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const isOwner = user && collection && user.username === collection.owner;
  const canRemoveItems = isOwner || !!collection?.can_remove_items;

  const openEdit = () => {
    if (!collection) return;
    setEditName(collection.name);
    setEditDescription(collection.description ?? '');
    setShowEdit(true);
  };

  const handleSave = async () => {
    if (!collection || !editName.trim()) return;
    await updateMutation.mutateAsync({
      id: collection.id,
      name: editName.trim(),
      description: editDescription.trim() || undefined,
    });
    setShowEdit(false);
  };

  const handleRemove = async () => {
    if (!removeTarget || !collectionId) return;
    await removeMutation.mutateAsync({ collectionId, itemId: removeTarget });
    setRemoveTarget(null);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 text-center text-muted-foreground">
        {t('common.loading')}
      </div>
    );
  }

  if (error || !collection) {
    return (
      <div className="container mx-auto px-4 py-8 text-center">
        <p className="text-destructive">{error?.message ?? 'Collection not found.'}</p>
        <Button asChild className="mt-4">
          <Link to="/collections">{t('collections.backToCollections')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8 space-y-6">
      {/* Back button */}
      <Button variant="ghost" onClick={() => navigate('/collections')} className="gap-2">
        <ArrowLeft className="h-4 w-4" />
        {t('collections.backToCollections')}
      </Button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <BookMarked className="h-6 w-6 text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold truncate">{collection.name}</h1>
            {collection.description && (
              <p className="text-sm text-muted-foreground mt-1">{collection.description}</p>
            )}
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span>
                {t('collections.owner')}: <span className="font-medium">{collection.owner}</span>
              </span>
              <span>
                {t('collections.created')}: {formatDate(collection.created_at, language)}
              </span>
              <Badge variant="secondary">
                {t('collections.itemCount').replace('{count}', collection.items_count)}
              </Badge>
            </div>
          </div>
        </div>

        {isOwner && (
          <Button variant="outline" size="sm" className="gap-2 shrink-0" onClick={openEdit}>
            <Edit3 className="h-4 w-4" />
            {t('collections.editCollection')}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="gap-2 shrink-0"
          onClick={() => setShowHistory(true)}
        >
          <History className="h-4 w-4" />
          {t('collections.historyButton')}
        </Button>
      </div>

      <Separator />

      {/* Items grid */}
      {collection.collection_items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ShoppingCart className="mx-auto h-12 w-12 mb-4 opacity-40" />
          <p>{t('collections.noItems')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {collection.collection_items.map(ci => {
            const item = ci.item;
            return (
              <Card
                key={ci.id}
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
                      const CategoryIcon = getCategoryIcon(item.category);
                      return (
                        <div className="flex h-full w-full items-center justify-center">
                          <CategoryIcon className="h-16 w-16 text-muted-foreground/50" />
                        </div>
                      );
                    })()
                  )}
                  {item.sales_type && (
                    <div className="absolute top-2 right-2">
                      <Badge className="text-xs">
                        {t(`item.salesType.badge.${item.sales_type}`)}
                      </Badge>
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
                    <p className="text-xs text-muted-foreground line-clamp-2">{ci.note}</p>
                  )}
                </div>

                {/* Remove button (owner or editor) */}
                {canRemoveItems && (
                  <div className="px-3 pb-3" onClick={e => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-muted-foreground hover:text-destructive gap-2"
                      onClick={e => {
                        e.stopPropagation();
                        setRemoveTarget(item.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
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
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('collections.editCollection')}</DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="details">
            <TabsList className="w-full">
              <TabsTrigger value="details" className="flex-1">
                {t('collections.detailsTab')}
              </TabsTrigger>
              <TabsTrigger value="permissions" className="flex-1">
                {t('collections.permissionsTab')}
              </TabsTrigger>
            </TabsList>

            {/* Details tab */}
            <TabsContent value="details" className="space-y-4 pt-4">
              <div className="space-y-1">
                <Label>{t('collections.name')}</Label>
                <Input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  placeholder={t('collections.namePlaceholder')}
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label>{t('collections.description')}</Label>
                <Textarea
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  placeholder={t('collections.descriptionPlaceholder')}
                  rows={3}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowEdit(false)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={!editName.trim() || updateMutation.isPending}
                >
                  {updateMutation.isPending ? t('common.saving') : t('collections.saveChanges')}
                </Button>
              </DialogFooter>
            </TabsContent>

            {/* Permissions tab */}
            <TabsContent value="permissions" className="pt-4">
              {collectionId && (
                <CollectionPermissionsPanel
                  collectionId={collectionId}
                  ownerUsername={collection?.owner}
                />
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Remove item confirmation */}
      <AlertDialog open={!!removeTarget} onOpenChange={open => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('collections.removeFromCollection')}</AlertDialogTitle>
            <AlertDialogDescription>{t('collections.confirmDelete')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemove}>{t('common.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default CollectionDetail;
