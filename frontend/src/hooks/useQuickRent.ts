import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { itemsQuickRentPdfRetrieve, publicItemsQuickRentCreate } from '@/services/django';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export const getQuickRentErrorMessage = (error: unknown): string | undefined => {
  const err = error as { non_field_errors?: string[]; detail?: string } | string | null;
  return typeof err === 'string' ? err : (err?.non_field_errors?.[0] ?? err?.detail);
};

/** Scan result: rent the item, return it, or learn who currently has it. */
export const useQuickRent = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (itemId: string) => {
      const response = await publicItemsQuickRentCreate({ path: { id: itemId } });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item'] });
    },
  });
};

/** Download the printable QR-code sheet of an item (owners only). */
export const useDownloadQuickRentPdf = () => {
  const { toast } = useToast();
  const { t } = useLanguage();

  return useMutation({
    mutationFn: async ({ itemId, fileName }: { itemId: string; fileName: string }) => {
      const response = await itemsQuickRentPdfRetrieve({
        path: { id: itemId },
        parseAs: 'blob',
      });
      const url = URL.createObjectURL(response.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      // Revoking synchronously can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onError: (error: unknown) => {
      console.error('Error downloading QR code PDF:', error);
      toast({
        title: t('common.error'),
        description: getQuickRentErrorMessage(error) || t('quickRent.pdfError'),
        variant: 'destructive',
      });
    },
  });
};
