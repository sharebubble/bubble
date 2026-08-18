import { ImageUploadStep } from '@/components/items/ImageUploadStep';
import { BackButton } from '@/components/layout/BackButton';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useCreateItem, useUpdateItem } from '@/hooks/useCreateItem';
import { Text, Title } from '@mantine/core';
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

  // Used by the wizard's own back/cancel button.
  const handleBack = () => {
    navigate('/');
  };

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      {/* Header with Back Button */}
      <div className="space-y-6">
        <BackButton />

        {/* Simple Header */}
        <div className="space-y-2">
          <Title order={1} size="h3">
            List New Item
          </Title>
          <Text c="dimmed">Upload images and let AI help create your listing</Text>
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
