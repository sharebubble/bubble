import { useLanguage } from '@/contexts/LanguageContext';
import type { CollectionList } from '@/services/django';
import { ActionIcon, Badge, Card, Text, Title } from '@mantine/core';
import { BookMarked, ChevronRight, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface CollectionCardProps {
  collection: CollectionList;
  isOwner?: boolean;
  onDelete?: (id: string) => void;
}

export const CollectionCard = ({ collection, isOwner, onDelete }: CollectionCardProps) => {
  const navigate = useNavigate();
  const { t } = useLanguage();

  return (
    <Card
      withBorder
      padding="md"
      className="group overflow-hidden transition-all duration-300 hover:shadow-strong hover:scale-105 animate-fade-in cursor-pointer"
      onClick={() => navigate(`/collections/${collection.id}`)}
    >
      <div className="flex items-start justify-between gap-2 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <BookMarked className="h-5 w-5 text-primary shrink-0" />
          <Title
            order={3}
            size="md"
            className="line-clamp-1 group-hover:text-primary transition-colors"
          >
            {collection.name}
          </Title>
        </div>
        <Badge variant="light" size="sm" className="shrink-0">
          {t('collections.itemCount').replace('{count}', collection.items_count)}
        </Badge>
      </div>

      {collection.description && (
        <Text size="sm" c="dimmed" lineClamp={2} className="pb-3">
          {collection.description}
        </Text>
      )}

      <div
        className="flex items-center justify-between gap-2 mt-auto"
        onClick={e => e.stopPropagation()}
      >
        <Text size="xs" c="dimmed">
          {t('collections.owner')}: {collection.owner}
        </Text>

        <div className="flex items-center gap-1">
          {isOwner && onDelete && (
            <ActionIcon
              variant="subtle"
              color="red"
              size="sm"
              title={t('collections.deleteCollection')}
              aria-label={t('collections.deleteCollection')}
              onClick={e => {
                e.stopPropagation();
                onDelete(collection.id);
              }}
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
            onClick={e => {
              e.stopPropagation();
              navigate(`/collections/${collection.id}`);
            }}
          >
            <ChevronRight size={16} />
          </ActionIcon>
        </div>
      </div>
    </Card>
  );
};
