import { ImageUploadStep } from '@/components/items/ImageUploadStep';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useCreateItem, useUpdateItem } from '@/hooks/useCreateItem';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface WizardData {
  images: { url: string; file: File }[];
  aiGeneratedData?: {
    title?: string;
    description?: string;
    category?: string;
    condition?: string;
    sales_type?: string;
    price?: number | null;
  };
  skipAI?: boolean;
  skipImages?: boolean;
  tempItemId?: string;
}

const CreateItem = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const createItemMutation = useCreateItem();
  const updateItemMutation = useUpdateItem();
  const [loading, setLoading] = useState(false);

  const handleImageStepComplete = async (data: WizardData) => {
    try {
      // Redirect to edit page instead of item detail
      navigate(`/edit-item/${data.tempItemId}`);
    } catch (error) {
      console.error('Error creating item:', error);
      toast({
        title: 'Error',
        description: 'Failed to create item. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleBack = () => {
    navigate('/');
  };

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      {/* Header with Back Button */}
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => navigate(-1)} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        {/* Simple Header */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">List New Item</h1>
          <p className="text-muted-foreground">Upload images and let AI help create your listing</p>
        </div>
      </div>

      {/* ImageUploadStep only */}
      <div className="mt-8">
        <ImageUploadStep onComplete={handleImageStepComplete} onBack={handleBack} />
      </div>
    </div>
  );
};

export default CreateItem;
