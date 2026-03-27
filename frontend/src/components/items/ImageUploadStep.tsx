import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { useCreateItem } from '@/hooks/useCreateItem';
import { imagesAPI } from '@/services/custom/images';
import { itemsAiDescribeUpdate, booksCreate, booksIsbnUpdateUpdate } from '@/services/django';
import { CheckCircle, Loader, SkipForward, Sparkles, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ImageManager } from './ImageManager';
import { BarcodeScanner } from './BarcodeScanner';

interface ImageUploadStepProps {
  onBack: () => void;
  onComplete: (data: any) => void;
}

type ProcessingState = 'idle' | 'uploading' | 'processing' | 'completed' | 'error';

export const ImageUploadStep = ({ onBack, onComplete }: ImageUploadStepProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { language, t } = useLanguage();
  const createItemMutation = useCreateItem();

  const [images, setImages] = useState<{ url: string; file: File }[]>([]);
  const [processingState, setProcessingState] = useState<ProcessingState>('idle');
  const [progress, setProgress] = useState(0);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [isbnScanning, setIsbnScanning] = useState(false);
  const timeoutRef = useRef<number | null>(null); // retained if future timeout needed
  const intervalRef = useRef<number | null>(null); // retained for progress animation
  const navigatedRef = useRef(false);

  const handleIsbnScan = async (isbn: string) => {
    setIsbnScanning(true);
    try {
      // Step 1: create a draft book (default to borrow for community lending)
      const createResponse = await booksCreate({
        body: {
          category: 'books',
          condition: 1,
          status: 0,
          sales_type: 'borrow',
          isbn_write: isbn,
        },
      });
      const newBook = createResponse.data;
      if (!newBook?.id) throw new Error('Failed to create draft book.');

      // Step 2: populate metadata from OpenLibrary via ISBN
      await booksIsbnUpdateUpdate({
        path: { id: newBook.id },
        body: { isbn },
      });

      toast({
        title: t('imageUpload.scanIsbnSuccessTitle'),
        description: t('imageUpload.scanIsbnSuccessDescription'),
      });

      navigate(`/edit-book/${newBook.id}`);
    } catch (err) {
      console.error('ISBN scan book creation failed:', err);
      toast({
        title: t('imageUpload.scanIsbnErrorTitle'),
        description: t('imageUpload.scanIsbnErrorDescription'),
        variant: 'destructive',
      });
    } finally {
      setIsbnScanning(false);
    }
  };

  const createDraftAndNavigate = useCallback(
    async (withAI: boolean) => {
      setProcessingState('uploading');
      setProgress(10);

      try {
        const draftItemData = {
          condition: 1 as const, // 'used'
          status: 0 as const, // 'draft'
          sales_type: 'donate' as const,
        };

        const newItem = await createItemMutation.mutateAsync(draftItemData);

        if (!newItem) {
          throw new Error('Failed to create draft item.');
        }

        const newItemUuid = newItem.id;

        setProgress(10);

        for (let i = 0; i < images.length; i++) {
          const file = images[i];
          try {
            await imagesAPI.createImage({
              item: newItemUuid,
              original: file.file,
              ordering: i,
            });
            setProgress(10 + ((i + 1) * 40) / images.length);
          } catch (error) {
            console.error('Error uploading image:', error);
          }
        }

        setProgress(50);

        if (withAI && images.length > 0) {
          setProcessingState('processing');
          setProgress(65);
          setActiveItemId(newItemUuid); // keeps UI in sync, but don't rely on it for immediate navigation
          toast({
            title: 'Item created',
            description: 'Generating AI content…',
          });

          try {
            // Light progress animation while waiting (65 -> 90)
            if (intervalRef.current) window.clearInterval(intervalRef.current);
            intervalRef.current = window.setInterval(() => {
              setProgress(prev => (prev < 90 ? prev + 1 : prev));
            }, 600);

            // Call Django AI endpoint using itemsAPI
            const response = await itemsAiDescribeUpdate({
              path: { id: newItemUuid },
            });

            if (response) {
              toast({
                title: 'AI Processing Complete',
                description: 'AI suggestions have been generated for your item.',
              });
              handleAICompletion('completed', newItemUuid);
            } else {
              console.error('AI generation failed:', response);
              toast({
                title: 'AI Failed',
                description: 'Continuing without AI suggestions.',
                variant: 'destructive',
              });
              handleAICompletion('failed', newItemUuid);
            }
          } catch (err) {
            console.error('AI processing error:', err);
            toast({
              title: 'AI Error',
              description: 'Opening editor so you can fill details manually.',
              variant: 'destructive',
            });
            handleAICompletion('failed', newItemUuid);
          }
          return; // stop normal navigation; handleAICompletion will navigate
        }

        // Non-AI path: navigate immediately
        const wizardData = {
          images: images,
          skipAI: true,
          tempItemId: newItemUuid,
        };
        onComplete(wizardData);
      } catch (error) {
        console.error('Error creating draft item:', error);
        setProcessingState('error');
        toast({
          title: 'Error',
          description: 'Failed to create draft item. Please try again.',
          variant: 'destructive',
        });
      }
    },
    [images, language, navigate, toast, createItemMutation],
  );

  const handleSkipAI = () => {
    createDraftAndNavigate(false);
  };

  const handleProceedWithAI = () => {
    createDraftAndNavigate(true);
  };

  const cleanupTimers = () => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const handleAICompletion = (reason: 'completed' | 'failed' | 'timeout', itemId?: string) => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    cleanupTimers();
    setProgress(100);
    setProcessingState('completed');

    const wizardData = {
      images: images,
      skipAI: reason !== 'completed',
      tempItemId: itemId || activeItemId,
    };

    onComplete(wizardData);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupTimers();
    };
  }, []);

  const getProcessingMessage = () => {
    switch (processingState) {
      case 'uploading':
        return 'Uploading images to storage...';
      case 'processing':
        return 'AI is analyzing your images and generating content...';
      case 'completed':
        return 'Processing complete!';
      case 'error':
        return 'An error occurred during processing.';
      default:
        return '';
    }
  };

  const isProcessing = processingState === 'uploading' || processingState === 'processing';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Item Images
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <ImageManager
            onImagesChange={setImages}
            onExistingImagesChange={() => {}}
            existingImages={[]}
            maxImages={16}
          />

          {images.length > 0 && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <CheckCircle className="h-3 w-3" />
                {images.length}{' '}
                {images.length !== 1
                  ? t('imageUpload.imagesUploadedPlural')
                  : t('imageUpload.imagesUploaded')}
              </Badge>
            </div>
          )}

          {/* Processing State */}
          {isProcessing && (
            <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                <Loader className="h-4 w-4 animate-spin" />
                <span className="text-sm font-medium">{getProcessingMessage()}</span>
              </div>
              <Progress value={progress} className="w-full" />
              {processingState === 'processing' && activeItemId && (
                <p className="text-xs text-muted-foreground">{t('imageUpload.aiGenerating')}</p>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col gap-3">
            {!isProcessing && processingState !== 'completed' && (
              <>
                <Button
                  onClick={handleProceedWithAI}
                  disabled={images.length === 0}
                  className="w-full gap-2"
                >
                  <Sparkles className="h-4 w-4" />
                  {t('imageUpload.continueWithAI')}
                </Button>

                <Button variant="outline" onClick={handleSkipAI} className="w-full gap-2">
                  <SkipForward className="h-4 w-4" />
                  {t('imageUpload.skipAndContinue')}
                </Button>

                {/* Scan ISBN */}
                <div>
                  {isbnScanning ? (
                    <Button variant="outline" disabled className="w-full gap-2">
                      <Loader className="h-4 w-4 animate-spin" />
                      {t('imageUpload.scanIsbnCreating')}
                    </Button>
                  ) : (
                    <BarcodeScanner
                      onScan={handleIsbnScan}
                      title={t('imageUpload.scanIsbn')}
                      fullWidth
                    />
                  )}
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
