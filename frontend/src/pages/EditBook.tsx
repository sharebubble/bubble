import { BarcodeScanner } from '@/components/items/BarcodeScanner';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { useUpdateItem } from '@/hooks/useCreateItem';
import { FieldStates } from '@/hooks/useFieldAutoSave';
import { cn } from '@/lib/utils';
import {
  BookWritable,
  CategoryEnum,
  ConditionEnum,
  PatchedBookWritable,
  RentalPeriodEnum,
  SalesTypeEnum,
  Status402Enum,
} from '@/services/django';
import {
  booksIsbnUpdateUpdate,
  booksPartialUpdate,
  booksRetrieve,
} from '@/services/django/sdk.gen';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import EditItem, { EditItemFormData } from './EditItem';

/** Convert comma-separated string to trimmed non-empty string array. */
const splitList = (value: string): string[] =>
  value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

/**
 * Map a formData field name to the corresponding BookWritable key and value.
 * Returns null for fields that should not be auto-saved this way (e.g. isbn,
 * which is handled by the dedicated ISBN-update endpoint).
 */
const bookFieldToPayload = (fieldName: string, value: unknown): PatchedBookWritable | null => {
  switch (fieldName) {
    case 'isbn':
      return { isbn_write: (value as string) || undefined };
    case 'year':
      return { year_write: value === '' || value === undefined ? null : parseInt(value as string) };
    case 'topic':
      return { topic_write: (value as string) || undefined };
    case 'authors':
      return { authors_write: splitList((value as string) || '') };
    case 'genres':
      return { genres_write: splitList((value as string) || '') };
    case 'publisher':
      return { publisher: (value as string) || undefined };
    case 'shelf':
      return { shelf_write: (value as string) || undefined };
    default:
      return null;
  }
};

const EditBook = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { itemUuid: editItemUuid } = useParams<{ itemUuid: string }>();
  const queryClient = useQueryClient();
  const updateItemMutation = useUpdateItem();

  // ── Book-field auto-save ──────────────────────────────────────────────────
  const [bookFieldStates, setBookFieldStates] = useState<FieldStates>({});
  const bookFieldTimeouts = useRef<Record<string, NodeJS.Timeout>>({});
  const bookOriginalValuesRef = useRef<Record<string, unknown>>({});

  const setBookFieldState = useCallback((fieldName: string, state: FieldStates[string]) => {
    setBookFieldStates(prev => ({ ...prev, [fieldName]: state }));
  }, []);

  const clearBookSuccessAfterDelay = useCallback((fieldName: string) => {
    if (bookFieldTimeouts.current[fieldName]) {
      clearTimeout(bookFieldTimeouts.current[fieldName]);
    }
    bookFieldTimeouts.current[fieldName] = setTimeout(() => {
      setBookFieldStates(prev => {
        if (prev[fieldName]?.status === 'success') {
          const next = { ...prev };
          delete next[fieldName];
          return next;
        }
        return prev;
      });
      delete bookFieldTimeouts.current[fieldName];
    }, 2000);
  }, []);

  const saveBookField = useCallback(
    async (fieldName: string, value: unknown) => {
      if (!editItemUuid) return;
      const payload = bookFieldToPayload(fieldName, value);
      if (!payload) return;

      setBookFieldState(fieldName, { status: 'saving' });
      try {
        await booksPartialUpdate({ path: { id: editItemUuid }, body: payload });
        setBookFieldState(fieldName, { status: 'success' });
        clearBookSuccessAfterDelay(fieldName);
        queryClient.invalidateQueries({ queryKey: ['book', editItemUuid] });
      } catch (error: unknown) {
        const raw = error as Record<string, unknown> | string | undefined;
        let errorMessage: string | undefined;
        if (raw && typeof raw === 'object') {
          const values = Object.values(raw);
          const first = values[0];
          errorMessage = Array.isArray(first)
            ? (first[0] as string)
            : (first as string | undefined);
        } else if (typeof raw === 'string') {
          errorMessage = raw;
        }
        setBookFieldState(fieldName, { status: 'error', errorMessage });
        toast({
          title: t('editItem.isbnInvalidErrorTitle'),
          description: errorMessage || t('editItem.isbnInvalidErrorDescription'),
          variant: 'destructive',
        });
      }
    },
    [editItemUuid, setBookFieldState, clearBookSuccessAfterDelay, queryClient, toast, t],
  );

  const handleBookFieldBlur = useCallback(
    (fieldName: string, value: unknown) => {
      if (!editItemUuid) return;
      const originalValue = bookOriginalValuesRef.current[fieldName];
      if (value !== originalValue) {
        bookOriginalValuesRef.current[fieldName] = value;
        void saveBookField(fieldName, value);
      }
    },
    [editItemUuid, saveBookField],
  );

  // ── Book data source ──────────────────────────────────────────────────────
  const {
    data: book,
    isLoading: loadingBook,
    error: bookError,
  } = useQuery({
    queryKey: ['book', editItemUuid],
    queryFn: async () => {
      if (!editItemUuid) throw new Error('No book UUID provided');
      const response = await booksRetrieve({ path: { id: editItemUuid } });
      return response.data;
    },
    enabled: !!editItemUuid,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const updateBookMutation = useMutation({
    mutationFn: async (data: { id: string; body: BookWritable }) => {
      const response = await booksPartialUpdate({
        path: { id: data.id },
        body: data.body,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['book', editItemUuid] });
      queryClient.invalidateQueries({ queryKey: ['my-items'] });
      toast({
        title: t('editItem.updateSuccessTitle'),
        description: t('editItem.updateSuccessDescription'),
      });
    },
    onError: (error: any) => {
      toast({
        title: t('editItem.updateErrorTitle'),
        description: error?.message || t('editItem.updateErrorDescription'),
        variant: 'destructive',
      });
    },
  });

  const isbnUpdateMutation = useMutation({
    mutationFn: async (data: { id: string; isbn: string }) => {
      const response = await booksIsbnUpdateUpdate({
        path: { id: data.id },
        body: { isbn: data.isbn },
      });
      return response.data;
    },
    onMutate: () => {
      setBookFieldState('isbn', { status: 'saving' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['book', editItemUuid] });
      setBookFieldState('isbn', { status: 'success' });
      clearBookSuccessAfterDelay('isbn');
      toast({
        title: t('editItem.isbnUpdateSuccessTitle'),
        description: t('editItem.isbnUpdateSuccessDescription'),
      });
    },
    onError: (error: any) => {
      setBookFieldState('isbn', { status: 'error', errorMessage: error?.message });
      toast({
        title: t('editItem.isbnUpdateErrorTitle'),
        description: error?.message || t('editItem.isbnUpdateErrorDescription'),
        variant: 'destructive',
      });
    },
  });

  const handleIsbnBlur = useCallback(
    (isbn: string) => handleBookFieldBlur('isbn', isbn),
    [handleBookFieldBlur],
  );

  // ── Helpers ───────────────────────────────────────────────────────────────
  const buildBookData = (
    formData: EditItemFormData,
    statusOverride?: Status402Enum,
  ): BookWritable => ({
    name: formData.name,
    description: formData.description,
    category: formData.category as CategoryEnum,
    condition: formData.condition as ConditionEnum,
    status:
      statusOverride ?? (formData.status !== '' ? (formData.status as Status402Enum) : undefined),
    sales_type: formData.sales_type !== '' ? (formData.sales_type as SalesTypeEnum) : undefined,
    price: formData.price === '' ? null : formData.price,
    rental_period:
      formData.sales_type !== 'rent' && formData.sales_type !== 'borrow'
        ? undefined
        : (formData.rental_period as RentalPeriodEnum | undefined),
    rental_self_service:
      formData.sales_type !== 'rent' && formData.sales_type !== 'borrow'
        ? undefined
        : formData.rental_self_service,
    rental_open_end:
      formData.sales_type !== 'rent' && formData.sales_type !== 'borrow'
        ? undefined
        : formData.rental_open_end,
    isbn_write: (formData.isbn as string) || undefined,
    year_write: (formData.year as string) === '' ? null : parseInt(formData.year as string),
    topic_write: (formData.topic as string) || undefined,
    authors_write: splitList((formData.authors as string) || ''),
    genres_write: splitList((formData.genres as string) || ''),
    publisher: (formData.publisher as string) || undefined,
    shelf_write: (formData.shelf as string) || undefined,
  });

  // ── Extension props passed to EditItem ────────────────────────────────────

  const onDataLoaded = (
    item: any,
    setFormData: React.Dispatch<React.SetStateAction<EditItemFormData>>,
  ) => {
    const extraData = {
      isbn: item.isbn || '',
      year: item.year?.toString() || '',
      topic: item.topic || '',
      authors: (item.authors as string[] | undefined)?.join(', ') || '',
      genres: (item.genres as string[] | undefined)?.join(', ') || '',
      publisher: item.verlag?.name || '',
      shelf: item.shelf?.name || '',
    };
    setFormData(prev => ({
      ...prev,
      ...extraData,
    }));
    // Track original values so blur only saves when something changed
    bookOriginalValuesRef.current = { ...extraData };
  };

  const onSubmitOverride = async (formData: EditItemFormData, itemUuid: string) => {
    await updateBookMutation.mutateAsync({ id: itemUuid, body: buildBookData(formData) });
    navigate('/my-items');
  };

  const onPublishOverride = async (formData: EditItemFormData, itemUuid: string) => {
    await updateBookMutation.mutateAsync({
      id: itemUuid,
      body: buildBookData(formData, 2 as Status402Enum),
    });
    toast({
      title: t('editItem.publishSuccessTitle'),
      description: t('editItem.publishSuccessDescription'),
    });
    navigate('/my-items');
  };

  const onCategoryChange = async (category: string, itemUuid: string | undefined) => {
    if (category !== 'books' && itemUuid) {
      try {
        await updateItemMutation.mutateAsync({
          itemUuid,
          data: { category: category as CategoryEnum },
        });
        navigate(`/edit-item/${itemUuid}`);
      } catch (err) {
        toast({
          title: t('editItem.updateErrorTitle'),
          description: (err as any)?.message || t('editItem.updateErrorDescription'),
          variant: 'destructive',
        });
      }
    }
  };

  const renderExtraHeaderButtons = (
    formData: EditItemFormData,
    _setFormData: React.Dispatch<React.SetStateAction<EditItemFormData>>,
  ) => (
    <Button
      type="button"
      variant="outline"
      className="gap-2"
      disabled={!formData.isbn || isbnUpdateMutation.isPending}
      onClick={() => {
        if (editItemUuid && formData.isbn) {
          isbnUpdateMutation.mutate({ id: editItemUuid, isbn: formData.isbn as string });
        }
      }}
    >
      <RefreshCw className={`h-4 w-4 ${isbnUpdateMutation.isPending ? 'animate-spin' : ''}`} />
      {t('editItem.refetchIsbn')}
    </Button>
  );

  const renderExtraMobileMenuItems = (
    formData: EditItemFormData,
    _setFormData: React.Dispatch<React.SetStateAction<EditItemFormData>>,
  ) => (
    <DropdownMenuItem
      disabled={!formData.isbn || isbnUpdateMutation.isPending}
      onSelect={() => {
        if (editItemUuid && formData.isbn) {
          isbnUpdateMutation.mutate({ id: editItemUuid, isbn: formData.isbn as string });
        }
      }}
    >
      <RefreshCw className={`h-4 w-4 mr-2 ${isbnUpdateMutation.isPending ? 'animate-spin' : ''}`} />
      {t('editItem.refetchIsbn')}
    </DropdownMenuItem>
  );

  const renderExtraFields = (
    formData: EditItemFormData,
    setFormData: React.Dispatch<React.SetStateAction<EditItemFormData>>,
    disabled: boolean,
  ) => {
    const handleBarcodeScan = async (scannedIsbn: string) => {
      setFormData(prev => ({ ...prev, isbn: scannedIsbn }));
      await saveBookField('isbn', scannedIsbn);
    };

    const fieldState = (name: string) => bookFieldStates[name];
    const borderClass = (name: string) => {
      const s = fieldState(name);
      if (s?.status === 'success') return 'border-green-500 focus-visible:ring-green-500';
      if (s?.status === 'error') return 'border-red-500 focus-visible:ring-red-500';
      return '';
    };

    const FieldIndicator = ({ name }: { name: string }) => {
      const s = fieldState(name);
      if (s?.status === 'saving')
        return (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        );
      if (s?.status === 'success')
        return (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <Check className="h-4 w-4 text-green-600" />
          </div>
        );
      return null;
    };

    return (
      <>
        {/* ISBN, Year, Topic */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="isbn">{t('editItem.isbn')}</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="isbn"
                  type="text"
                  placeholder={t('editItem.enterIsbn')}
                  value={(formData.isbn as string) || ''}
                  onChange={e => setFormData(prev => ({ ...prev, isbn: e.target.value }))}
                  onBlur={() => handleIsbnBlur((formData.isbn as string) || '')}
                  disabled={disabled}
                  className={cn('pr-8', borderClass('isbn'))}
                />
                <FieldIndicator name="isbn" />
              </div>
              <BarcodeScanner onScan={handleBarcodeScan} title={t('editItem.scanIsbn')} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="year">{t('editItem.year')}</Label>
            <div className="relative">
              <Input
                id="year"
                type="number"
                placeholder={t('editItem.enterYear')}
                value={(formData.year as string) || ''}
                onChange={e => setFormData(prev => ({ ...prev, year: e.target.value }))}
                onBlur={() => handleBookFieldBlur('year', formData.year)}
                disabled={disabled}
                className={cn('pr-8', borderClass('year'))}
              />
              <FieldIndicator name="year" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="topic">{t('editItem.topic')}</Label>
            <div className="relative">
              <Input
                id="topic"
                type="text"
                placeholder={t('editItem.enterTopic')}
                value={(formData.topic as string) || ''}
                onChange={e => setFormData(prev => ({ ...prev, topic: e.target.value }))}
                onBlur={() => handleBookFieldBlur('topic', formData.topic)}
                disabled={disabled}
                className={cn('pr-8', borderClass('topic'))}
              />
              <FieldIndicator name="topic" />
            </div>
          </div>
        </div>

        {/* Authors and Genres */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="authors">{t('editItem.authors')}</Label>
            <div className="relative">
              <Input
                id="authors"
                type="text"
                placeholder={t('editItem.enterAuthors')}
                value={(formData.authors as string) || ''}
                onChange={e => setFormData(prev => ({ ...prev, authors: e.target.value }))}
                onBlur={() => handleBookFieldBlur('authors', formData.authors)}
                disabled={disabled}
                className={cn('pr-8', borderClass('authors'))}
              />
              <FieldIndicator name="authors" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="genres">{t('editItem.genres')}</Label>
            <div className="relative">
              <Input
                id="genres"
                type="text"
                placeholder={t('editItem.enterGenres')}
                value={(formData.genres as string) || ''}
                onChange={e => setFormData(prev => ({ ...prev, genres: e.target.value }))}
                onBlur={() => handleBookFieldBlur('genres', formData.genres)}
                disabled={disabled}
                className={cn('pr-8', borderClass('genres'))}
              />
              <FieldIndicator name="genres" />
            </div>
          </div>
        </div>

        {/* Publisher and Shelf */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="publisher">{t('editItem.publisher')}</Label>
            <div className="relative">
              <Input
                id="publisher"
                type="text"
                placeholder={t('editItem.enterPublisher')}
                value={(formData.publisher as string) || ''}
                onChange={e => setFormData(prev => ({ ...prev, publisher: e.target.value }))}
                onBlur={() => handleBookFieldBlur('publisher', formData.publisher)}
                disabled={disabled}
                className={cn('pr-8', borderClass('publisher'))}
              />
              <FieldIndicator name="publisher" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="shelf">{t('editItem.shelf')}</Label>
            <div className="relative">
              <Input
                id="shelf"
                type="text"
                placeholder={t('editItem.enterShelf')}
                value={(formData.shelf as string) || ''}
                onChange={e => setFormData(prev => ({ ...prev, shelf: e.target.value }))}
                onBlur={() => handleBookFieldBlur('shelf', formData.shelf)}
                disabled={disabled}
                className={cn('pr-8', borderClass('shelf'))}
              />
              <FieldIndicator name="shelf" />
            </div>
          </div>
        </div>
      </>
    );
  };

  return (
    <EditItem
      dataOverride={{
        data: book,
        isLoading: loadingBook,
        error: bookError as Error | null,
      }}
      onDataLoaded={onDataLoaded}
      onSubmitOverride={onSubmitOverride}
      onPublishOverride={onPublishOverride}
      onCategoryChange={onCategoryChange}
      renderExtraHeaderButtons={renderExtraHeaderButtons}
      renderExtraMobileMenuItems={renderExtraMobileMenuItems}
      renderExtraFields={renderExtraFields}
    />
  );
};

export default EditBook;
