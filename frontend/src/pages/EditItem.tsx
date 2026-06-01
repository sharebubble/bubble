import { AccessManager } from '@/components/items/AccessManager';
import { ImageManager } from '@/components/items/ImageManager';
import {
  BasicFields,
  CategoryConditionFields,
  PricingFields,
  StatusField,
  VisibilityField,
} from '@/components/items/ItemFormFields';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { useUpdateItem } from '@/hooks/useCreateItem';
import { useMyItem } from '@/hooks/useMyItem';
import { imagesAPI } from '@/services/custom/images';
import {
  CategoryEnum,
  ConditionEnum,
  Image,
  imagesPartialUpdate,
  itemsAiDescribeUpdate,
  itemsAiImageUpdate,
  PatchedItemWritable,
  RentalPeriodEnum,
  SalesTypeEnum,
  StatusB0aEnum,
  VisibilityEnum,
} from '@/services/django';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Loader,
  MoreVertical,
  Sparkles,
} from 'lucide-react';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFieldAutoSave } from '@/hooks/useFieldAutoSave';

export type EditItemFormData = {
  name: string;
  description: string;
  category: CategoryEnum | '';
  condition: ConditionEnum | '';
  status: StatusB0aEnum | '';
  visibility: VisibilityEnum | '';
  sales_type: SalesTypeEnum | '';
  price: string;
  rental_period: RentalPeriodEnum | '';
  rental_self_service: boolean;
  rental_open_end: boolean;
  [key: string]: unknown;
};

export type EditItemExtensionProps = {
  /**
   * Override the data source. If provided, useMyItem is not called internally.
   */
  dataOverride?: {
    data: any;
    isLoading: boolean;
    error: Error | null;
  };
  /**
   * Called after item data loads. Use this to populate extra form fields.
   */
  onDataLoaded?: (
    item: any,
    setFormData: React.Dispatch<React.SetStateAction<EditItemFormData>>,
  ) => void;
  /**
   * Extra fields rendered inside the form, directly after CategoryConditionFields.
   */
  renderExtraFields?: (
    formData: EditItemFormData,
    setFormData: React.Dispatch<React.SetStateAction<EditItemFormData>>,
    disabled: boolean,
    onFieldBlur?: (fieldName: string, value: unknown) => void,
    onFieldChange?: (fieldName: string, value: unknown) => void,
  ) => ReactNode;
  /**
   * Extra buttons rendered in the card header alongside the AI magic button (desktop only).
   */
  renderExtraHeaderButtons?: (
    formData: EditItemFormData,
    setFormData: React.Dispatch<React.SetStateAction<EditItemFormData>>,
  ) => ReactNode;
  /**
   * Extra items rendered inside the mobile three-dot DropdownMenu.
   * Each item should be a <DropdownMenuItem> element.
   */
  renderExtraMobileMenuItems?: (
    formData: EditItemFormData,
    setFormData: React.Dispatch<React.SetStateAction<EditItemFormData>>,
  ) => ReactNode;
  /**
   * Override the save (PATCH) logic. Receives the current formData and itemUuid.
   * If provided, the default itemsPartialUpdate call is skipped.
   */
  onSubmitOverride?: (formData: EditItemFormData, itemUuid: string) => Promise<void>;
  /**
   * Override the publish logic. Receives the current formData and itemUuid.
   * If provided, the default publish call is skipped.
   */
  onPublishOverride?: (formData: EditItemFormData, itemUuid: string) => Promise<void>;
  /**
   * Override the category-change handler. If not provided, the default behaviour
   * (navigate to /edit-book when category becomes 'books') is used.
   */
  onCategoryChange?: (category: string, editItemUuid: string | undefined) => Promise<void>;
};

const EditItem = (props: EditItemExtensionProps = {}) => {
  const {
    dataOverride,
    onDataLoaded,
    renderExtraFields,
    renderExtraHeaderButtons,
    renderExtraMobileMenuItems,
    onSubmitOverride,
    onPublishOverride,
    onCategoryChange: onCategoryChangeProp,
  } = props;

  const navigate = useNavigate();
  const [incompleteWarningOpen, setIncompleteWarningOpen] = useState(false);
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const { itemUuid: editItemUuid } = useParams<{ itemUuid: string }>();
  const queryClient = useQueryClient();

  const internalData = useMyItem(dataOverride ? undefined : editItemUuid);
  const { data: item, isLoading: loadingItem, error } = dataOverride ?? internalData;

  const updateItemMutation = useUpdateItem();

  const [loading, setLoading] = useState(false);
  const [aiProcessing, setAiProcessing] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [images, setImages] = useState<{ url: string; file: File }[]>([]);
  const [existingImages, setExistingImages] = useState<Image[]>([]);
  const [resetNewImagesToken, setResetNewImagesToken] = useState<number | undefined>(undefined);
  const [processingState, setProcessingState] = useState<
    'idle' | 'uploading' | 'processing' | 'completed' | 'error'
  >('idle');
  const [progress, setProgress] = useState(0);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const [formData, setFormData] = useState<EditItemFormData>({
    name: '',
    description: '',
    category: '' as CategoryEnum | '',
    condition: '' as ConditionEnum | '',
    status: '' as StatusB0aEnum | '',
    visibility: 1 as VisibilityEnum | '',
    sales_type: '' as SalesTypeEnum | '',
    price: '',
    rental_period: '' as RentalPeriodEnum | '',
    rental_self_service: false,
    rental_open_end: false,
  });

  const { fieldStates, saveField } = useFieldAutoSave(editItemUuid);
  const originalValuesRef = useRef<Record<string, unknown>>({});

  const handleFieldBlur = useCallback(
    (fieldName: string, value: unknown) => {
      if (!editItemUuid) return;
      const originalValue = originalValuesRef.current[fieldName];
      if (value !== originalValue) {
        originalValuesRef.current[fieldName] = value;
        saveField(fieldName, value);
      }
    },
    [editItemUuid, saveField],
  );

  const handleFieldChange = useCallback(
    (fieldName: string, value: unknown) => {
      if (!editItemUuid) return;
      const originalValue = originalValuesRef.current[fieldName];
      if (value !== originalValue) {
        originalValuesRef.current[fieldName] = value;
        saveField(fieldName, value);
      }
    },
    [editItemUuid, saveField],
  );

  const missingFields = useMemo(() => {
    const missing: string[] = [];
    if (!formData.name) missing.push(t('editItem.name'));
    if (!formData.category) missing.push(t('editItem.category'));
    if (formData.condition === '') missing.push(t('editItem.condition'));
    if (!formData.sales_type) missing.push(t('item.salesType.label'));
    return missing;
  }, [formData.name, formData.category, formData.condition, formData.sales_type, t]);

  const handleBackClick = useCallback(() => {
    if (editItemUuid && missingFields.length > 0) {
      setIncompleteWarningOpen(true);
    } else {
      navigate(-1);
    }
  }, [editItemUuid, missingFields.length, navigate]);

  const handleConfirmLeave = useCallback(() => {
    setIncompleteWarningOpen(false);
    navigate(-1);
  }, [navigate]);

  const categories: CategoryEnum[] = [
    'electronics',
    'furniture',
    'clothing',
    'books',
    'sports',
    'tools',
    'kitchen',
    'garden',
    'toys',
    'vehicles',
    'rooms',
    'other',
  ];

  // Load existing item data if editing
  useEffect(() => {
    if (item && editItemUuid) {
      const loadedData = {
        name: item.name || '',
        description: item.description || '',
        category: item.category || '',
        condition: item.condition !== undefined ? item.condition : '',
        status: item.status !== undefined && item.status !== null ? item.status : '',
        visibility: item.visibility !== undefined && item.visibility !== null ? item.visibility : 1,
        sales_type: item.sales_type || '',
        price: item.price?.toString() || '',
        rental_period: (item.rental_period as RentalPeriodEnum) || '',
        rental_self_service:
          item.rental_self_service !== undefined ? item.rental_self_service : false,
        rental_open_end: item.rental_open_end !== undefined ? item.rental_open_end : false,
      };

      setFormData(prev => ({
        ...prev,
        ...loadedData,
      }));

      originalValuesRef.current = {
        name: loadedData.name,
        description: loadedData.description,
        category: loadedData.category,
        condition: loadedData.condition,
        status: loadedData.status,
        visibility: loadedData.visibility,
        sales_type: loadedData.sales_type,
        price: loadedData.price === '' ? null : loadedData.price,
        rental_period: loadedData.rental_period,
        rental_self_service: loadedData.rental_self_service,
        rental_open_end: loadedData.rental_open_end,
      };

      // Allow extensions to populate extra fields
      if (onDataLoaded) {
        onDataLoaded(item, setFormData);
      }

      // Use Django images directly without transformation
      if (item.images && Array.isArray(item.images)) {
        setExistingImages(item.images);
      }
      // Adjust textarea height to match loaded content
      setTimeout(() => adjustDescriptionHeight(), 0);
    }
  }, [item, editItemUuid]);

  // Handle error
  if (error) {
    toast({
      title: 'Error',
      description: 'Failed to load item data.',
      variant: 'destructive',
    });
    navigate('/');
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required fields
    if (!formData.name || !formData.category || formData.condition === '') {
      console.log(formData);
      toast({
        title: 'Missing Information',
        description: 'Please fill in all required fields.',
        variant: 'destructive',
      });
      return;
    }

    if (!formData.sales_type) {
      toast({
        title: 'Missing Information',
        description: 'Please select a listing type.',
        variant: 'destructive',
      });
      return;
    }

    if (!editItemUuid) {
      toast({
        title: 'Error',
        description: 'Item UUID is required for editing.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      if (onSubmitOverride) {
        await onSubmitOverride(formData, editItemUuid);
      } else {
        const isRent = formData.sales_type === 'rent';
        const hasRentalOptions = formData.sales_type === 'rent' || formData.sales_type === 'borrow';
        const itemData = {
          name: formData.name,
          description: formData.description,
          category: formData.category as CategoryEnum,
          condition: formData.condition as ConditionEnum,
          status: formData.status !== '' ? (formData.status as StatusB0aEnum) : undefined,
          visibility:
            formData.visibility !== '' ? (formData.visibility as VisibilityEnum) : undefined,
          sales_type: formData.sales_type as SalesTypeEnum,
          price: formData.price === '' ? null : formData.price,
          rental_period: hasRentalOptions
            ? (formData.rental_period as RentalPeriodEnum | undefined)
            : undefined,
          rental_self_service: hasRentalOptions ? formData.rental_self_service : undefined,
          rental_open_end: hasRentalOptions ? formData.rental_open_end : undefined,
        };

        await updateItemMutation.mutateAsync({
          itemUuid: editItemUuid,
          data: itemData,
        });

        // Navigate to my items page
        navigate('/my-items');
      }
    } catch (error) {
      console.error('Error updating item:', error);
      // Error toast is handled by the mutation
    } finally {
      setLoading(false);
    }
  };

  const handlePublish = async () => {
    // Validate required fields
    if (!formData.name || !formData.category || formData.condition === '') {
      console.log(formData);
      toast({
        title: 'Missing Information',
        description: 'Please fill in all required fields before publishing.',
        variant: 'destructive',
      });
      return;
    }

    if (!formData.sales_type) {
      toast({
        title: 'Missing Information',
        description: 'Please select a listing type before publishing.',
        variant: 'destructive',
      });
      return;
    }

    if (!editItemUuid) {
      toast({
        title: 'Error',
        description: 'Item UUID is required for publishing.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      if (onPublishOverride) {
        await onPublishOverride(formData, editItemUuid);
      } else {
        const hasRentalOptions = formData.sales_type === 'rent' || formData.sales_type === 'borrow';
        const itemData: PatchedItemWritable = {
          name: formData.name,
          description: formData.description,
          category: formData.category as CategoryEnum,
          condition: formData.condition as ConditionEnum,
          status: 2, // Set to Available
          visibility:
            formData.visibility !== '' ? (formData.visibility as VisibilityEnum) : undefined,
          sales_type: formData.sales_type as SalesTypeEnum,
          price: formData.price === '' ? null : formData.price,
          rental_period: hasRentalOptions
            ? (formData.rental_period as RentalPeriodEnum | undefined)
            : undefined,
          rental_self_service: hasRentalOptions ? formData.rental_self_service : undefined,
          rental_open_end: hasRentalOptions ? formData.rental_open_end : undefined,
        };

        await updateItemMutation.mutateAsync({
          itemUuid: editItemUuid,
          data: itemData,
        });

        toast({
          title: 'Success',
          description: 'Item published successfully!',
        });

        // Navigate to my items page
        navigate('/my-items');
      }
    } catch (error) {
      console.error('Error publishing item:', error);
      toast({
        title: 'Error',
        description: 'Failed to publish item. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const uploadImages = async () => {
    if (!editItemUuid) {
      toast({
        title: 'Error',
        description: 'Item UUID is required for AI processing.',
        variant: 'destructive',
      });
      return;
    }

    if (images.length === 0) {
      toast({
        title: 'No Images',
        description: 'Please upload at least one image to use AI processing.',
        variant: 'destructive',
      });
      return;
    }

    setProcessingState('uploading');
    setProgress(10);

    try {
      // Upload new images if any and collect returned Image objects
      const uploadedImages = [] as Image[];
      for (let i = 0; i < images.length; i++) {
        const file = images[i];
        try {
          // Upload image via Django API
          const created = await imagesAPI.createImage({
            item: editItemUuid,
            original: file.file,
            ordering: i,
          });
          uploadedImages.push(created);
          setProgress(10 + Math.round(((i + 1) * 90) / images.length));
        } catch (error) {
          console.error('Error uploading image:', error);
          throw error;
        }
      }

      // Merge newly uploaded images into existingImages and set ordering sequentially
      if (uploadedImages.length > 0) {
        const merged = [...existingImages, ...uploadedImages].map((img, idx) => ({
          ...img,
          ordering: idx,
        }));

        setExistingImages(merged);

        // Persist ordering for all images to backend
        try {
          await Promise.all(
            merged.map(img =>
              imagesPartialUpdate({
                path: { id: img.id },
                body: { ordering: img.ordering },
              }),
            ),
          );
        } catch (err) {
          console.error('Failed to persist image ordering after upload', err);
        }
      }

      // Clear uploaded images and notify ImageManager to clear its local preview state
      setImages([]); // Clear uploaded images
      // bump token so ImageManager clears its internal newImages state
      setResetNewImagesToken(prev => (prev === undefined ? 1 : prev + 1));
      setProcessingState('idle');
      setProgress(0);
    } catch (error) {
      console.error('Error uploading images:', error);
    }
  };

  // Auto-upload newly selected images immediately when in edit mode
  useEffect(() => {
    // Only auto-upload when editing an existing item (we need an item UUID)
    if (!editItemUuid) return;
    // Don't trigger during AI operations or if already uploading/processing
    if (aiProcessing) return;
    if (processingState !== 'idle') return;
    // Only run when there are new images pending upload
    if (images.length === 0) return;

    // Start upload
    // Note: uploadImages clears `images` on success, so this effect won't loop.
    void uploadImages();
  }, [images, editItemUuid, aiProcessing, processingState]);

  const getProcessingMessage = () => {
    switch (processingState) {
      case 'uploading':
        return t('editItem.uploadingImages');
      case 'processing':
        return t('editItem.aiProcessing');
      case 'completed':
        return t('editItem.processingCompleted');
      case 'error':
        return t('editItem.processingError');
      default:
        return '';
    }
  };

  const adjustDescriptionHeight = () => {
    if (descriptionRef.current) {
      descriptionRef.current.style.height = 'auto';
      descriptionRef.current.style.height = descriptionRef.current.scrollHeight + 5 + 'px';
    }
  };

  const handleAiProcess = async () => {
    if (!editItemUuid) {
      toast({
        title: 'Error',
        description: 'Item UUID is required for AI processing.',
        variant: 'destructive',
      });
      return;
    }

    setAiProcessing(true);

    try {
      const aiResult = await itemsAiDescribeUpdate({
        path: { id: editItemUuid },
      });
      const data = aiResult.data;

      // Update form data with AI-generated content
      setFormData(prevData => ({
        ...prevData,
        name: data.name || prevData.name,
        description: data.description || prevData.description,
        category: (data.category as CategoryEnum) || prevData.category,
        price: data.price?.toString() || prevData.price,
        sales_type: data.sales_type || prevData.sales_type,
      }));

      // Ensure textarea resizes after AI update
      setTimeout(() => adjustDescriptionHeight(), 0);

      toast({
        title: 'AI Processing Complete',
        description: 'Item details have been automatically updated based on the images.',
      });
    } catch (error) {
      console.error('Error processing with AI:', error);
      toast({
        title: 'AI Processing Failed',
        description: 'Failed to process item with AI. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setAiProcessing(false);
    }
  };

  const handleAiImageGenerate = async () => {
    if (!editItemUuid) {
      toast({
        title: 'Error',
        description: 'Item UUID is required for AI processing.',
        variant: 'destructive',
      });
      return;
    }

    if (!formData.name && !formData.description) {
      toast({
        title: 'Missing Information',
        description: 'Please provide a name or description to generate an image.',
        variant: 'destructive',
      });
      return;
    }

    setAiProcessing(true);

    try {
      await itemsAiImageUpdate({
        path: { id: editItemUuid },
        body: {
          name: formData.name,
          description: formData.description,
        },
      });

      toast({
        title: 'AI Image Generation Complete',
        description: 'A new image has been generated based on the item details.',
      });

      // Invalidate the query to refetch item data
      await queryClient.invalidateQueries({ queryKey: ['item', editItemUuid] });
    } catch (error) {
      console.error('Error generating image with AI:', error);
      toast({
        title: 'AI Image Generation Failed',
        description: 'Failed to generate image with AI. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setAiProcessing(false);
    }
  };

  const handleCategoryChange = async (category: string) => {
    // Update local state immediately
    setFormData(prev => ({ ...prev, category: category as CategoryEnum }));

    if (onCategoryChangeProp) {
      await onCategoryChangeProp(category, editItemUuid);
      return;
    }

    // Default: if switching to books, persist change first then navigate
    if (category === 'books' && editItemUuid) {
      try {
        await updateItemMutation.mutateAsync({
          itemUuid: editItemUuid,
          data: { category: category as CategoryEnum },
        });
        navigate(`/edit-book/${editItemUuid}`);
      } catch (err) {
        console.error('Error updating category before switching to EditBook:', err);
        toast({
          title: t('editItem.updateErrorTitle'),
          description: (err as any)?.message || t('editItem.updateErrorDescription'),
          variant: 'destructive',
        });
      }
    }
  };

  if (loadingItem) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-0 p-3">
      {/* Back Button */}
      <Button variant="ghost" onClick={handleBackClick} className="mb-6 gap-2">
        <ArrowLeft className="h-4 w-4" />
        {t('common.back')}
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{editItemUuid ? t('itemDetail.editItem') : t('editItem.name')}</CardTitle>
            <div className="flex gap-2 items-center">
              {/* ── Desktop: inline buttons ── */}
              <div className="hidden md:flex gap-2">
                {renderExtraHeaderButtons && renderExtraHeaderButtons(formData, setFormData)}
                {editItemUuid &&
                  (existingImages.length > 0 ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={aiProcessing}
                        className="gap-2"
                        onClick={() => setAiDialogOpen(true)}
                      >
                        <Sparkles className={`h-4 w-4 ${aiProcessing ? 'animate-spin' : ''}`} />
                        {aiProcessing ? t('editItem.aiMagicProcessing') : t('editItem.aiMagic')}
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        aiProcessing ||
                        (!formData.name && !formData.description) ||
                        images.length < 1
                      }
                      className="gap-2"
                      onClick={handleAiImageGenerate}
                    >
                      <Sparkles className={`h-4 w-4 ${aiProcessing ? 'animate-spin' : ''}`} />
                      {aiProcessing ? t('editItem.aiMagicProcessing') : t('editItem.aiMagic')}
                    </Button>
                  ))}
              </div>

              {/* ── Mobile: three-dot menu ── */}
              {editItemUuid && (
                <div className="flex md:hidden">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon">
                        <MoreVertical className="h-5 w-5" />
                        <span className="sr-only">More options</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {/* AI magic item */}
                      {existingImages.length > 0 ? (
                        <DropdownMenuItem
                          disabled={aiProcessing}
                          onSelect={() => setAiDialogOpen(true)}
                        >
                          <Sparkles
                            className={`h-4 w-4 mr-2 ${aiProcessing ? 'animate-spin' : ''}`}
                          />
                          {aiProcessing ? t('editItem.aiMagicProcessing') : t('editItem.aiMagic')}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          disabled={
                            aiProcessing ||
                            (!formData.name && !formData.description) ||
                            images.length < 1
                          }
                          onSelect={handleAiImageGenerate}
                        >
                          <Sparkles
                            className={`h-4 w-4 mr-2 ${aiProcessing ? 'animate-spin' : ''}`}
                          />
                          {aiProcessing ? t('editItem.aiMagicProcessing') : t('editItem.aiMagic')}
                        </DropdownMenuItem>
                      )}
                      {/* Extension-provided items */}
                      {renderExtraMobileMenuItems &&
                        renderExtraMobileMenuItems(formData, setFormData)}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

              {formData.status === 0 && editItemUuid && (
                <Button
                  type="button"
                  variant="default"
                  onClick={handlePublish}
                  disabled={loading || updateItemMutation.isPending || aiProcessing}
                  className="gap-2"
                >
                  {t('editItem.publish')}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        {/* Warning dialog for incomplete fields when navigating away */}
        <AlertDialog open={incompleteWarningOpen} onOpenChange={setIncompleteWarningOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                {t('editItem.incompleteWarningTitle')}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('editItem.incompleteWarningDescription')}
                <ul className="mt-2 list-disc list-inside text-sm">
                  {missingFields.map(field => (
                    <li key={field}>{field}</li>
                  ))}
                </ul>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('editItem.stayAndComplete')}</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmLeave}>
                {t('editItem.leaveAnyway')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* AI confirm dialog — controlled by state, shared between desktop button and mobile menu */}
        <AlertDialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('editItem.aiMagicWarningTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('editItem.aiMagicWarningDescription')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('editItem.aiMagicWarningCancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={handleAiProcess}>
                {t('editItem.aiMagicWarningContinue')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <CardContent>
          <form onSubmit={e => e.preventDefault()} className="space-y-6">
            {/* Image Upload and AI Processing Section */}
            <Card className="border-dashed">
              <CardContent className="space-y-4">
                <ImageManager
                  onImagesChange={setImages}
                  onExistingImagesChange={setExistingImages}
                  existingImages={existingImages}
                  maxImages={16}
                  isEditing={!aiProcessing}
                  resetNewImagesToken={resetNewImagesToken}
                />

                {images.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="gap-1">
                      <CheckCircle className="h-3 w-3" />
                      {images.length} new image
                      {images.length !== 1 ? 's' : ''} ready to upload
                    </Badge>
                  </div>
                )}

                {/* Processing State */}
                {processingState !== 'idle' && (
                  <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Loader className="h-4 w-4 animate-spin" />
                      <span className="text-sm font-medium">{getProcessingMessage()}</span>
                    </div>
                    <Progress value={progress} className="w-full" />
                  </div>
                )}
              </CardContent>
            </Card>

            <BasicFields
              formData={formData}
              setFormData={setFormData}
              disabled={aiProcessing}
              descriptionRef={descriptionRef}
              fieldStates={fieldStates}
              onFieldBlur={handleFieldBlur}
            />

            <CategoryConditionFields
              formData={formData}
              setFormData={setFormData}
              categories={categories}
              onCategoryChange={handleCategoryChange}
              fieldStates={fieldStates}
              onFieldChange={handleFieldChange}
            />

            {renderExtraFields &&
              renderExtraFields(
                formData,
                setFormData,
                aiProcessing,
                handleFieldBlur,
                handleFieldChange,
              )}

            <PricingFields
              formData={formData}
              setFormData={setFormData}
              disabled={aiProcessing}
              fieldStates={fieldStates}
              onFieldBlur={handleFieldBlur}
              onFieldChange={handleFieldChange}
            />

            <div className="flex items-end justify-between gap-4 pt-4">
              {/* Status field */}
              <div className="flex gap-4">
                <StatusField
                  formData={formData}
                  setFormData={setFormData}
                  disabled={aiProcessing}
                  fieldStates={fieldStates}
                  onFieldChange={handleFieldChange}
                />
              </div>

              <div className="flex gap-2">
                {formData.status === 0 && editItemUuid && (
                  <Button
                    type="button"
                    variant="default"
                    onClick={handlePublish}
                    disabled={loading || updateItemMutation.isPending || aiProcessing}
                    className="gap-2"
                  >
                    {t('editItem.publish')}
                  </Button>
                )}
              </div>
            </div>
          </form>

          {/* Collapsible visibility & access section */}
          {editItemUuid && (
            <Collapsible open={accessOpen} onOpenChange={setAccessOpen} className="mt-6">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 border-t pt-4 text-sm font-medium hover:text-foreground text-muted-foreground transition-colors"
                >
                  {accessOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  {t('editItem.accessSection')}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-4 space-y-6">
                <VisibilityField
                  formData={formData}
                  setFormData={setFormData}
                  disabled={aiProcessing}
                  fieldStates={fieldStates}
                  onFieldChange={handleFieldChange}
                />
                <AccessManager itemId={editItemUuid} visibility={formData.visibility} />
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default EditItem;
