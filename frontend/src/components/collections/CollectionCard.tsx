import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import type { CollectionList } from '@/services/django';
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
      className="group overflow-hidden transition-all duration-300 hover:shadow-strong hover:scale-105 border-border animate-fade-in cursor-pointer"
      onClick={() => navigate(`/collections/${collection.id}`)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <BookMarked className="h-5 w-5 text-primary shrink-0" />
            <h3 className="font-semibold text-foreground line-clamp-1 group-hover:text-primary transition-colors">
              {collection.name}
            </h3>
          </div>
          <Badge variant="secondary" className="shrink-0 text-xs">
            {t('collections.itemCount').replace('{count}', collection.items_count)}
          </Badge>
        </div>
      </CardHeader>

      {collection.description && (
        <CardContent className="py-0 pb-3">
          <p className="text-sm text-muted-foreground line-clamp-2">{collection.description}</p>
        </CardContent>
      )}

      <CardFooter
        className="px-4 pb-3 pt-0 flex items-center justify-between gap-2"
        onClick={e => e.stopPropagation()}
      >
        <span className="text-xs text-muted-foreground">
          {t('collections.owner')}: {collection.owner}
        </span>

        <div className="flex items-center gap-1">
          {isOwner && onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              title={t('collections.deleteCollection')}
              onClick={e => {
                e.stopPropagation();
                onDelete(collection.id);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={t('common.open')}
            onClick={e => {
              e.stopPropagation();
              navigate(`/collections/${collection.id}`);
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
};
