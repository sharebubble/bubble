import { ActionIcon, Badge, Text } from '@mantine/core';
import { useLanguage } from '@/contexts/LanguageContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { useToast } from '@/hooks/use-toast';
import { imagesAPI } from '@/services/custom/images';
import { type Image, imagesDestroy, imagesPartialUpdate } from '@/services/django';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Image as ImageIcon,
  RotateCcw,
  RotateCw,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

export interface NewImage {
  url: string;
  file: File;
}

interface ImageManagerProps {
  onImagesChange: (newImages: NewImage[]) => void;
  onExistingImagesChange?: (existingImages: Image[]) => void;
  existingImages?: Image[];
  maxImages?: number;
  isEditing?: boolean;
  resetNewImagesToken?: number;
  /** Files dropped externally (e.g. full-page drop zone). Consumed once, then cleared. */
  externalFiles?: File[];
  onExternalFilesConsumed?: () => void;
}

export const ImageManager = ({
  onImagesChange,
  onExistingImagesChange,
  existingImages = [],
  maxImages = 16,
  isEditing = false,
  resetNewImagesToken,
  externalFiles,
  onExternalFilesConsumed,
}: ImageManagerProps) => {
  const [newImages, setNewImages] = useState<NewImage[]>([]);
  const [currentExistingImages, setCurrentExistingImages] = useState<Image[]>(existingImages);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const { toast } = useToast();
  const { t } = useLanguage();
  const isMobile = useIsMobile();

  useEffect(() => {
    setCurrentExistingImages(existingImages);
  }, [existingImages]);

  // If parent requests clearing new images (via token), clear local newImages
  useEffect(() => {
    // Only act if parent provided a token prop and it has changed
    if (resetNewImagesToken === undefined || resetNewImagesToken === 0) return;

    // Revoke all object URLs and clear local new images
    setNewImages(prev => {
      for (const img of prev) {
        try {
          URL.revokeObjectURL(img.url);
        } catch (e) {
          // ignore
        }
      }
      return [];
    });
    onImagesChange([]);
  }, [resetNewImagesToken, onImagesChange]);

  // Cleanup on unmount: revoke any remaining object URLs
  useEffect(() => {
    return () => {
      setNewImages(prev => {
        for (const img of prev) {
          try {
            URL.revokeObjectURL(img.url);
          } catch (e) {
            // ignore
          }
        }
        return prev;
      });
    };
  }, []);

  // Consume files dropped from an external (full-page) drop zone
  useEffect(() => {
    if (!externalFiles || externalFiles.length === 0) return;
    processFiles(externalFiles);
    onExternalFilesConsumed?.();
  }, [externalFiles]);

  const totalImages = currentExistingImages.length + newImages.length;

  const processFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;

      if (totalImages + files.length > maxImages) {
        toast({
          title: t('imageManager.tooManyTitle'),
          description: t('imageManager.tooManyDescription').replace('{max}', String(maxImages)),
          variant: 'destructive',
        });
        return;
      }

      const validNewImages: NewImage[] = [];
      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          toast({
            title: t('imageManager.invalidTypeTitle'),
            description: t('imageManager.invalidTypeDescription'),
            variant: 'destructive',
          });
          continue;
        }
        if (file.size > 20 * 1024 * 1024) {
          // 20MB limit
          toast({
            title: t('imageManager.fileTooLargeTitle'),
            description: t('imageManager.fileTooLargeDescription'),
            variant: 'destructive',
          });
          continue;
        }
        const url = URL.createObjectURL(file);
        validNewImages.push({ url, file });
      }

      if (validNewImages.length > 0) {
        const updatedNewImages = [...newImages, ...validNewImages];
        setNewImages(updatedNewImages);
        onImagesChange(updatedNewImages);
      }
    },
    [newImages, totalImages, maxImages, onImagesChange, toast],
  );

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      processFiles(files);
    },
    [processFiles],
  );

  const handleCameraCapture = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      processFiles(files);
    },
    [processFiles],
  );

  const removeNewImage = useCallback(
    (index: number) => {
      if (index < 0 || index >= newImages.length) return;
      const updatedImages = newImages.filter((_, i) => i !== index);
      // Revoke the object URL to free memory
      try {
        URL.revokeObjectURL(newImages[index].url);
      } catch (e) {
        // ignore
      }
      setNewImages(updatedImages);
      onImagesChange(updatedImages);
    },
    [newImages, onImagesChange],
  );

  const removeExistingImage = useCallback(
    async (imageId: string) => {
      try {
        // Use Django API to delete the image
        await imagesDestroy({ path: { id: imageId } });

        const updatedExistingImages = currentExistingImages.filter(img => img.id !== imageId);

        // Reorder remaining images
        const reorderedImages = updatedExistingImages.map((img, index) => ({
          ...img,
          ordering: index,
        }));

        setCurrentExistingImages(reorderedImages);
        onExistingImagesChange?.(reorderedImages);

        toast({
          title: t('imageManager.deleteSuccessTitle'),
          description: t('imageManager.deleteSuccessDescription'),
        });
      } catch (error) {
        console.error('Error deleting image:', error);
        toast({
          title: t('imageManager.deleteErrorTitle'),
          description: t('imageManager.deleteErrorDescription'),
          variant: 'destructive',
        });
      }
    },
    [currentExistingImages, onExistingImagesChange, toast],
  );

  const rotateExistingImage = useCallback(
    async (imageId: string, direction: 'left' | 'right') => {
      setRotatingId(imageId);
      try {
        const updated = await imagesAPI.rotateImage(imageId, direction);
        // Force a cache-busted thumbnail URL so the browser re-fetches the rotated image
        const cacheBustedUpdated: Image = {
          ...updated,
          thumbnail: updated.thumbnail
            ? `${updated.thumbnail.split('?')[0]}?t=${Date.now()}`
            : updated.thumbnail,
        };
        setCurrentExistingImages(prev =>
          prev.map(img => (img.id === imageId ? cacheBustedUpdated : img)),
        );
        onExistingImagesChange?.(
          currentExistingImages.map(img => (img.id === imageId ? cacheBustedUpdated : img)),
        );
      } catch (error) {
        console.error('Error rotating image:', error);
        toast({
          title: t('imageManager.rotateErrorTitle'),
          description: t('imageManager.rotateErrorDescription'),
          variant: 'destructive',
        });
      } finally {
        setRotatingId(null);
      }
    },
    [currentExistingImages, onExistingImagesChange, toast, t],
  );

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();

    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      return;
    }

    const reorderedImages = [...currentExistingImages];
    const [draggedImage] = reorderedImages.splice(draggedIndex, 1);
    reorderedImages.splice(dropIndex, 0, draggedImage);

    // Update ordering
    const updatedImages = reorderedImages.map((img, index) => ({
      ...img,
      ordering: index,
    }));

    setCurrentExistingImages(updatedImages);
    setDraggedIndex(null);

    // Update in database using Django API
    try {
      const updatePromises = updatedImages.map(img =>
        imagesPartialUpdate({
          path: { id: img.id },
          body: {
            ordering: img.ordering,
          },
        }),
      );

      await Promise.all(updatePromises);
      onExistingImagesChange?.(updatedImages);

      toast({
        title: 'Success',
        description: 'Images reordered successfully',
      });
    } catch (error) {
      console.error('Error reordering images:', error);
      toast({
        title: 'Error',
        description: 'Failed to reorder images',
        variant: 'destructive',
      });
    }
  };

  const moveImage = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      const all = [
        ...currentExistingImages.map((img, index) => ({
          type: 'existing' as const,
          data: img,
          index,
        })),
        ...newImages.map((img, index) => ({
          type: 'new' as const,
          data: img,
          index: currentExistingImages.length + index,
        })),
      ].sort((a, b) => a.index - b.index);

      if (toIndex < 0 || toIndex >= all.length) return;

      const reordered = [...all];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);

      // Build updated existing and new arrays
      const updatedExisting = reordered
        .filter(i => i.type === 'existing')
        .map(i => i.data as Image)
        .map((img, idx) => ({ ...img, ordering: idx }));
      const updatedNew = reordered.filter(i => i.type === 'new').map(i => i.data as NewImage);

      setCurrentExistingImages(updatedExisting);
      setNewImages(updatedNew);
      onImagesChange(updatedNew);
      onExistingImagesChange?.(updatedExisting);

      // Persist ordering for existing images
      try {
        await Promise.all(
          updatedExisting.map(img =>
            imagesPartialUpdate({
              path: { id: img.id },
              body: { ordering: img.ordering },
            }),
          ),
        );
      } catch (err) {
        console.error('Failed to persist image ordering after move', err);
        toast({
          title: 'Error',
          description: 'Failed to persist image ordering',
          variant: 'destructive',
        });
      }
    },
    [currentExistingImages, newImages, onExistingImagesChange, onImagesChange, toast],
  );

  // Combine and sort all images for display
  const allImages = [
    ...currentExistingImages.map((img, index) => ({
      type: 'existing' as const,
      data: img,
      index,
    })),
    ...newImages.map((img, index) => ({
      type: 'new' as const,
      data: img,
      index: currentExistingImages.length + index,
    })),
  ].sort((a, b) => a.index - b.index);

  return (
    <div className="space-y-2 px-0 md-0 p-3">
      <div className="flex items-center justify-between pt-4">
        <Text component="label" size="sm" fw={500}>
          {t('imageManager.imagesLabel')}
          {isEditing && ' ' + t('imageManager.dragToReorder')}
        </Text>
        <Badge variant="light" color="gray">
          {totalImages} / {maxImages}
        </Badge>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {allImages.map((item, displayIndex) => (
          <div
            key={item.type === 'existing' ? item.data.id : `new-${item.index}`}
            className="relative group"
            draggable={item.type === 'existing' && isEditing}
            onDragStart={() => item.type === 'existing' && handleDragStart(item.index)}
            onDragOver={handleDragOver}
            onDrop={e => item.type === 'existing' && handleDrop(e, item.index)}
          >
            <img
              src={
                item.type === 'existing'
                  ? (item.data.thumbnail ?? item.data.original)
                  : item.data.url
              }
              alt={`Image ${displayIndex + 1}`}
              className="w-full h-32 object-contain rounded-lg border cursor-pointer bg-muted"
              onClick={() =>
                setSelectedIndex(prev => (prev === displayIndex ? null : displayIndex))
              }
            />

            {/* Drag Handle for existing images */}
            {item.type === 'existing' && isEditing && (
              <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <GripVertical className="h-4 w-4 text-white bg-black/50 rounded p-0.5" />
              </div>
            )}

            {/* Delete Button */}
            <ActionIcon
              color="red"
              size="sm"
              className={`absolute top-2 right-2 transition-opacity ${
                selectedIndex === displayIndex ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
              onClick={() => {
                if (item.type === 'existing') {
                  removeExistingImage(item.data.id);
                } else {
                  removeNewImage(item.index - currentExistingImages.length);
                }
              }}
              aria-label={t('imageManager.delete')}
            >
              <X size={12} />
            </ActionIcon>

            {/* Rotate Buttons — only for saved images */}
            {item.type === 'existing' && isEditing && (
              <div
                className={`absolute bottom-2 right-2 flex gap-1 transition-opacity ${
                  selectedIndex === displayIndex
                    ? 'opacity-100'
                    : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <button
                  type="button"
                  disabled={rotatingId === item.data.id}
                  className="bg-black/60 hover:bg-black/80 text-white rounded p-0.5 disabled:opacity-50"
                  onClick={() => rotateExistingImage(item.data.id, 'left')}
                  aria-label={t('imageManager.rotateLeft')}
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  disabled={rotatingId === item.data.id}
                  className="bg-black/60 hover:bg-black/80 text-white rounded p-0.5 disabled:opacity-50"
                  onClick={() => rotateExistingImage(item.data.id, 'right')}
                  aria-label={t('imageManager.rotateRight')}
                >
                  <RotateCw className="h-3 w-3" />
                </button>
              </div>
            )}

            {/* Primary Badge */}
            {displayIndex === 0 && <Badge className="absolute bottom-2 left-2">Primary</Badge>}
            {/* Mobile move controls */}
            {isMobile && (
              <div
                className={`absolute inset-0 flex items-center justify-between px-1 pointer-events-none transition-opacity ${
                  selectedIndex === displayIndex
                    ? 'opacity-100'
                    : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <button
                  type="button"
                  className="pointer-events-auto bg-white/80 rounded-full p-1 shadow-xs"
                  onClick={() => moveImage(displayIndex, displayIndex - 1)}
                >
                  <ChevronLeft className="h-4 w-4 text-black dark:text-black" />
                </button>
                <button
                  type="button"
                  className="pointer-events-auto bg-white/80 rounded-full p-1 shadow-xs"
                  onClick={() => moveImage(displayIndex, displayIndex + 1)}
                >
                  <ChevronRight className="h-4 w-4 text-black dark:text-black" />
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Add New Image Button(s) */}
        {totalImages < maxImages &&
          (isMobile ? (
            <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg h-32 flex flex-col items-center justify-center p-2 gap-2 hover:border-muted-foreground/50 transition-colors">
              {/* Hidden inputs */}
              <input
                id="camera-image"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleCameraCapture}
                className="hidden"
              />
              <input
                id="device-images"
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              {/* Buttons */}
              <div className="flex items-center gap-2 w-full">
                <label
                  htmlFor="camera-image"
                  className="cursor-pointer flex-1 flex flex-col items-center justify-center gap-1 px-2 py-1.5 rounded-md border hover:bg-muted/50"
                >
                  <Camera className="h-5 w-5 text-muted-foreground" />
                  <span className="text-xs">Camera</span>
                </label>
                <label
                  htmlFor="device-images"
                  className="cursor-pointer flex-1 flex flex-col items-center justify-center gap-1 px-2 py-1.5 rounded-md border hover:bg-muted/50"
                >
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                  <span className="text-xs">Upload</span>
                </label>
              </div>
            </div>
          ) : (
            <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg h-32 flex flex-col items-center justify-center hover:border-muted-foreground/50 transition-colors">
              <input
                id="images"
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              <label
                htmlFor="images"
                className="cursor-pointer flex flex-col items-center justify-center h-full w-full"
              >
                <ImageIcon className="h-8 w-8 text-muted-foreground mb-2" />
                <Text size="sm" c="dimmed" component="span">
                  Add Image
                </Text>
              </label>
            </div>
          ))}
      </div>

      <Text size="sm" c="dimmed">
        {t('imageManager.uploadInstructions')
          .replace('{max}', String(maxImages))
          .replace('{drag}', isEditing ? ' ' + t('imageManager.dragToReorder') : '')}
      </Text>
    </div>
  );
};
