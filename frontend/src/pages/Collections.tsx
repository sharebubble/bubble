import { CollectionCard } from '@/components/collections/CollectionCard';
import { BackButton } from '@/components/layout/BackButton';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import {
  useAllCollections,
  useCreateCollection,
  useDeleteCollection,
} from '@/hooks/useCollections';
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { BookMarked, ChevronRight, Grid3X3, List, Plus, Search, Trash2 } from 'lucide-react';
import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

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
  const [onlyMine, setOnlyMine] = useState(false);
  const [search, setSearch] = useState('');

  // View mode lives in the URL (rather than localStorage) so the view
  // survives a refresh and a shared link reproduces what was shared.
  const [searchParams, setSearchParams] = useSearchParams();
  const viewMode: 'list' | 'cards' = searchParams.get('view') === 'cards' ? 'cards' : 'list';

  const toggleViewMode = (mode: 'list' | 'cards') => {
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        if (mode === 'list') next.delete('view');
        else next.set('view', mode);
        return next;
      },
      { replace: true },
    );
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

  const confirmDelete = (id: string) => {
    modals.openConfirmModal({
      title: t('collections.deleteCollection'),
      children: <Text size="sm">{t('collections.confirmDelete')}</Text>,
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(id),
    });
  };

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <BackButton />
          <Title order={1} size="h3">
            {t('collections.header.myCollections')}
          </Title>
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center gap-1 border rounded-lg p-1">
            <ActionIcon
              variant={viewMode === 'list' ? 'filled' : 'subtle'}
              color={viewMode === 'list' ? 'green' : 'gray'}
              size="md"
              onClick={() => toggleViewMode('list')}
              title={t('collections.viewList')}
              aria-label={t('collections.viewList')}
            >
              <List size={16} />
            </ActionIcon>
            <ActionIcon
              variant={viewMode === 'cards' ? 'filled' : 'subtle'}
              color={viewMode === 'cards' ? 'green' : 'gray'}
              size="md"
              onClick={() => toggleViewMode('cards')}
              title={t('collections.viewGrid')}
              aria-label={t('collections.viewGrid')}
            >
              <Grid3X3 size={16} />
            </ActionIcon>
          </div>
          {user && (
            <Button size="sm" leftSection={<Plus size={16} />} onClick={() => setShowCreate(true)}>
              <span className="sm:hidden">{t('collections.newCollectionShort')}</span>
              <span className="hidden sm:inline">{t('collections.newCollection')}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <TextInput
          className="w-full flex-1"
          size="sm"
          leftSection={<Search size={16} />}
          placeholder={t('collections.searchPlaceholder')}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <Checkbox
          className="shrink-0"
          checked={onlyMine}
          onChange={e => setOnlyMine(e.currentTarget.checked)}
          label={t('collections.onlyMine')}
        />
      </div>

      {/* Loading */}
      {isLoading && (
        <Text component="div" c="dimmed" className="text-center py-16">
          {t('common.loading')}
        </Text>
      )}

      {/* Empty state */}
      {!isLoading && filtered.length === 0 && (
        <Text component="div" c="dimmed" className="text-center py-16">
          <BookMarked className="mx-auto h-12 w-12 mb-4 opacity-40" />
          <p>{t('collections.noCollections')}</p>
        </Text>
      )}

      {/* List view */}
      {!isLoading && filtered.length > 0 && viewMode === 'list' && (
        <div className="rounded-lg border overflow-hidden">
          <Table.ScrollContainer minWidth={640} type="native">
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('collections.name')}</Table.Th>
                  <Table.Th>{t('collections.description')}</Table.Th>
                  <Table.Th>{t('collections.owner')}</Table.Th>
                  <Table.Th className="text-center">
                    {t('collections.itemCount').replace('{count}', '')}
                  </Table.Th>
                  <Table.Th className="w-20"></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filtered.map(col => {
                  const isOwner = user?.username === col.owner;
                  return (
                    <Table.Tr
                      key={col.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/collections/${col.id}`)}
                    >
                      <Table.Td>
                        <div className="flex items-center gap-2">
                          <BookMarked className="h-4 w-4 text-primary shrink-0" />
                          <span className="font-medium truncate max-w-40">{col.name}</span>
                        </div>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed" truncate className="max-w-48 block">
                          {col.description || '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {col.owner}
                        </Text>
                      </Table.Td>
                      <Table.Td className="text-center">
                        <Badge variant="light" size="sm">
                          {col.items_count}
                        </Badge>
                      </Table.Td>
                      <Table.Td onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {isOwner && (
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              size="sm"
                              title={t('collections.deleteCollection')}
                              aria-label={t('collections.deleteCollection')}
                              onClick={() => confirmDelete(col.id)}
                            >
                              <Trash2 size={14} />
                            </ActionIcon>
                          )}
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="sm"
                            title={t('common.open')}
                            aria-label={t('common.open')}
                            onClick={() => navigate(`/collections/${col.id}`)}
                          >
                            <ChevronRight size={16} />
                          </ActionIcon>
                        </div>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
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
              onDelete={id => confirmDelete(id)}
            />
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Modal
        opened={showCreate}
        onClose={() => setShowCreate(false)}
        title={t('collections.createCollection')}
      >
        <div className="space-y-4 py-2">
          <TextInput
            label={t('collections.name')}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder={t('collections.namePlaceholder')}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            data-autofocus
          />
          <Textarea
            label={t('collections.description')}
            value={newDescription}
            onChange={e => setNewDescription(e.target.value)}
            placeholder={t('collections.descriptionPlaceholder')}
            rows={3}
          />
        </div>
        <Group justify="flex-end" mt="md">
          <Button variant="outline" onClick={() => setShowCreate(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleCreate} disabled={!newName.trim() || createMutation.isPending}>
            {createMutation.isPending ? t('common.saving') : t('collections.createCollection')}
          </Button>
        </Group>
      </Modal>
    </div>
  );
};

export default Collections;
