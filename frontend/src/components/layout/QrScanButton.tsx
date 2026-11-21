import { BarcodeScanner } from '@/components/items/BarcodeScanner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { itemPathFromScan } from '@/lib/routes';
import type { BarcodeFormat } from 'barcode-detector/ponyfill';
import { ScanQrCode } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const QR_FORMATS: BarcodeFormat[] = ['qr_code'];

/** Camera button that scans an item's quick-rent QR code and opens it in-app. */
export const QrScanButton = () => {
  const { t } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleScan = (value: string) => {
    const path = itemPathFromScan(value);
    if (path) {
      navigate(path);
      return;
    }
    toast({
      title: t('qrScan.unknownTitle'),
      description: t('qrScan.unknownDescription'),
      variant: 'destructive',
    });
  };

  return (
    <BarcodeScanner
      onScan={handleScan}
      formats={QR_FORMATS}
      preferNative
      icon={ScanQrCode}
      iconSize={20}
      title={t('qrScan.title')}
      description={t('qrScan.description')}
      triggerProps={{ variant: 'default', hiddenFrom: 'md' }}
    />
  );
};
