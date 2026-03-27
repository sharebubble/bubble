import { CollectionCard } from '@/components/collections/CollectionCard';
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import {
  useAllCollections,
  useCreateCollection,
  useDeleteCollection,
} from '@/hooks/useCollections';
import { BookMarked, ChevronRight, Grid3X3, List, Plus, Search, Trash2 } from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const LS_KEY = 'collectionsViewMode';

const Collections = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { data: collections, isLoading } = useAllCollections();
  const createMutation = useCreateCollection();
  const deleteMutation = useDeleteCollection();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('list');

  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY) as 'list' | 'cards' | null;
    if (saved) setViewMode(saved);
  }, []);

  const toggleViewMode = (mode: 'list' | 'cards') => {
    setViewMode(mode);
    localStorage.setItem(LS_KEY, mode);
  };

  const filtered = useMemo(() => {
    if (!collections) return [];
    let result = collections;
    if (onlyMine && user) {
      result = result.filter(c => c.owner === user.username);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        c => c.name?.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q),
      );
    }
    return result;
  }, [collections, onlyMine, search, user]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createMutation.mutateAsync({
      name: newName.trim(),
      description: newDescription.trim() || undefined,
    });
    setShowCreate(false);
    setNewName('');
    setNewDescription('');
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteMutation.mutateAsync(deleteTarget);
    setDeleteTarget(null);
  };

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <BookMarked className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">{t('collections.header.myCollections')}</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center gap-1 border rounded-lg p-1">
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => toggleViewMode('list')}
              className="h-8 w-8 p-0"
              title={t('collections.viewList')}
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'cards' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => toggleViewMode('cards')}
              className="h-8 w-8 p-0"
              title={t('collections.viewGrid')}
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
          </div>
          {user && (
            <Button size="sm" className="gap-2" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" />
              <span className="sm:hidden">{t('collections.newCollectionShort')}</span>
              <span className="hidden sm:inline">{t('collections.newCollection')}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9 h-9 text-sm"
            placeholder={t('collections.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
          <Checkbox checked={onlyMine} onCheckedChange={v => setOnlyMine(!!v)} />
          <span className="text-sm">{t('collections.onlyMine')}</span>
        </label>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="text-center py-16 text-muted-foreground">{t('common.loading')}</div>
      )}

      {/* Empty state */}
      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <BookMarked className="mx-auto h-12 w-12 mb-4 opacity-40" />
          <p>{t('collections.noCollections')}</p>
        </div>
      )}

      {/* List view */}
      {!isLoading && filtered.length > 0 && viewMode === 'list' && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('collections.name')}</TableHead>
                <TableHead>{t('collections.description')}</TableHead>
                <TableHead>{t('collections.owner')}</TableHead>
                <TableHead className="text-center">
                  {t('collections.itemCount').replace('{count}', '')}
                </TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(col => {
                const isOwner = user?.username === col.owner;
                return (
                  <TableRow
                    key={col.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/collections/${col.id}`)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <BookMarked className="h-4 w-4 text-primary shrink-0" />
                        <span className="font-medium truncate max-w-40">{col.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground truncate max-w-48 block">
                        {col.description || '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">{col.owner}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary" className="text-xs">
                        {col.items_count}
                      </Badge>
                    </TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {isOwner && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            title={t('collections.deleteCollection')}
                            onClick={() => setDeleteTarget(col.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title={t('common.open')}
                          onClick={() => navigate(`/collections/${col.id}`)}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Grid view */}
      {!isLoading && filtered.length > 0 && viewMode === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(col => (
            <CollectionCard
              key={col.id}
              collection={col}
              isOwner={user?.username === col.owner}
              onDelete={id => setDeleteTarget(id)}
            />
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('collections.createCollection')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>{t('collections.name')}</Label>
              <Input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder={t('collections.namePlaceholder')}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label>{t('collections.description')}</Label>
              <Textarea
                value={newDescription}
                onChange={e => setNewDescription(e.target.value)}
                placeholder={t('collections.descriptionPlaceholder')}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || createMutation.isPending}>
              {createMutation.isPending ? t('common.saving') : t('collections.createCollection')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('collections.deleteCollection')}</AlertDialogTitle>
            <AlertDialogDescription>{t('collections.confirmDelete')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>{t('common.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Collections;
