import { ActionIcon, Alert, Button, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import { BarcodeDetector, prepareZXingModule } from 'barcode-detector/ponyfill';

import { useLanguage } from '@/contexts/LanguageContext';
import { Scan, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

// Log library versions for debugging (values injected at build time by Vite define)
declare const __BARCODE_DETECTOR_VERSION__: string;
declare const __ZXING_WASM_VERSION__: string;
console.info(
  `[BarcodeScanner] barcode-detector v${__BARCODE_DETECTOR_VERSION__}, ` +
    `zxing-wasm v${__ZXING_WASM_VERSION__}`,
);

// Override the locateFile function
prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) => {
      if (path.endsWith('.wasm')) {
        return `/lib/wasm/${path}`;
      }
      return prefix + path;
    },
  },
});
interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  title?: string; // optional override for dialog title
  fullWidth?: boolean; // render as a full-width button with label text
}

export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({ onScan, title, fullWidth }) => {
  const { t } = useLanguage();
  // Always use the ZXing polyfill — native BarcodeDetector is unreliable for ISBN/EAN
  const isNativeBarcodeDetector = false;
  const [isOpen, setIsOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedBarcode, setDetectedBarcode] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const detectorRef = useRef<BarcodeDetector | null>(null);

  useEffect(() => {
    // Initialize detector when component mounts.
    // Always use the ZXing-based ponyfill — the native BarcodeDetector API is unreliable
    // for ISBN/EAN scanning, so we shadow it before constructing the detector.
    const initDetector = async () => {
      const nativeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'BarcodeDetector');
      try {
        (globalThis as any).BarcodeDetector = undefined;
        detectorRef.current = new BarcodeDetector({
          formats: [
            'ean_13', // ISBN-13 is encoded as EAN-13
            'ean_8',
            'upc_a',
            'upc_e',
            'code_128',
            'code_39',
            'code_93',
          ],
        });
        setIsInitialized(true);
      } catch (err) {
        setError('Failed to initialize barcode detector');
      } finally {
        // Restore the native implementation so other code is unaffected
        if (nativeDescriptor) {
          Object.defineProperty(globalThis, 'BarcodeDetector', nativeDescriptor);
        } else {
          delete (globalThis as any).BarcodeDetector;
        }
      }
    };
    initDetector();
  }, []);

  const startScanning = async () => {
    // Wait for detector to be initialized
    if (!detectorRef.current) {
      // Retry after a short delay
      await new Promise(resolve => setTimeout(resolve, 100));

      if (!detectorRef.current) {
        setError('Barcode detector failed to initialize. Please refresh the page.');
        return;
      }
    }

    if (!videoRef.current) {
      setError('Video element not available');
      return;
    }

    try {
      setError(null);

      // Check if mediaDevices API is available (requires HTTPS on Chromium)
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError(
          'Camera API not available. Please ensure you are using HTTPS and a supported browser.',
        );
        return;
      }

      // For Chromium browsers, explicitly check/request permission first
      // This helps trigger the permission prompt properly on mobile
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const permissionStatus = await navigator.permissions.query({
            name: 'camera' as PermissionName,
          });

          if (permissionStatus.state === 'denied') {
            setError(
              'Camera permission was denied. Please enable camera access in your browser settings.',
            );
            return;
          }
        } catch {
          // Some browsers don't support querying camera permission, continue anyway
        }
      }

      // Request camera access with constraints
      // Using exact facingMode can fail on some devices, so we use ideal
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' }, // Use back camera on mobile
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      videoRef.current.srcObject = stream;

      // Ensure video element is properly configured for autoplay on mobile
      videoRef.current.setAttribute('playsinline', 'true');
      videoRef.current.setAttribute('autoplay', 'true');

      await videoRef.current.play();

      // This is the key change: We now set the state and let the useEffect handle the loop.
      setIsScanning(true);
    } catch (err) {
      // Provide more specific error messages based on error type
      const error = err as DOMException;
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setError(
          'Camera permission was denied. Please allow camera access and try again. You may need to reset permissions in your browser settings.',
        );
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        setError('No camera found. Please ensure your device has a camera.');
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        setError(
          'Camera is in use by another application. Please close other apps using the camera.',
        );
      } else if (error.name === 'OverconstrainedError') {
        // Try again with less strict constraints
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
          streamRef.current = fallbackStream;
          videoRef.current!.srcObject = fallbackStream;
          await videoRef.current!.play();
          setIsScanning(true);
          return;
        } catch {
          setError('Could not access camera with required settings.');
        }
      } else if (error.name === 'SecurityError') {
        setError(
          'Camera access blocked due to security restrictions. Please ensure the page is served over HTTPS.',
        );
      } else {
        setError(`Failed to access camera: ${error.message || 'Unknown error'}`);
      }
      setIsScanning(false);
    }
  };

  // This new useEffect hook ensures the scan loop starts only after the state is updated.
  useEffect(() => {
    if (isScanning) {
      scanFrame();
    }
  }, [isScanning]);

  const scanFrame = async () => {
    if (!videoRef.current || !detectorRef.current || !isScanning) {
      return;
    }

    try {
      // New logging in the scan loop
      if (videoRef.current.readyState < 2) {
        // Wait for the video to have enough data
        await new Promise(resolve => {
          const checkReadyState = () => {
            if (videoRef.current && videoRef.current.readyState >= 2) {
              resolve(null);
            } else {
              requestAnimationFrame(checkReadyState);
            }
          };
          checkReadyState();
        });
      }

      const barcodes = await detectorRef.current.detect(videoRef.current);

      if (barcodes.length > 0) {
        setDetectedBarcode(barcodes[0].rawValue);

        // Call the callback with the detected barcode
        onScan(barcodes[0].rawValue);

        // Stop scanning after successful detection
        stopScanning();
        setIsOpen(false);

        return;
      }
    } catch (err) {
      // Silent error handling
    }

    // Continue scanning
    animationFrameRef.current = requestAnimationFrame(scanFrame);
  };

  const stopScanning = () => {
    setIsScanning(false);

    // Cancel animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Stop video stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Clear video source
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setDetectedBarcode(null);
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);

    if (!open) {
      stopScanning();
    }
  };

  useEffect(() => {
    if (isOpen) {
      // Use a timeout to allow the dialog to render and the videoRef to be set.
      const timer = setTimeout(() => {
        startScanning();
      }, 150); // A small delay is often necessary for portal-based dialogs

      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      stopScanning();
    };
  }, []);

  return (
    <>
      {fullWidth ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => handleOpenChange(true)}
          disabled={!isInitialized}
          fullWidth
          leftSection={!isInitialized ? <Loader size={16} /> : <Scan size={16} />}
        >
          {title ?? t('scanner.open')}
        </Button>
      ) : (
        <ActionIcon
          variant="outline"
          size="lg"
          onClick={() => handleOpenChange(true)}
          title={title ?? t('scanner.open')}
          aria-label={title ?? t('scanner.open')}
          disabled={!isInitialized}
          loading={!isInitialized}
        >
          <Scan size={16} />
        </ActionIcon>
      )}

      <Modal
        opened={isOpen}
        onClose={() => handleOpenChange(false)}
        title={title ?? t('scanner.title')}
        size={600}
      >
        <Stack gap="md">
          <div>
            <Text size="sm" c="dimmed">
              {t('scanner.description')}
            </Text>
            <Text size="xs" c="dimmed" mt={8}>
              {isNativeBarcodeDetector ? t('scanner.usingNative') : t('scanner.usingPolyfill')}
            </Text>
          </div>

          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}

          <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
              autoPlay
              webkit-playsinline="true"
            />

            {/* Scanning overlay */}
            {isScanning && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-64 h-48 border-4 border-[var(--mantine-color-green-6)] rounded-lg">
                  <div className="absolute inset-x-0 top-1/2 h-0.5 bg-[var(--mantine-color-green-6)] animate-pulse" />
                </div>
              </div>
            )}

            {/* Loading indicator */}
            {!isScanning && !error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="text-center space-y-2">
                  <Loader color="white" size={32} className="mx-auto" />
                  <p className="text-white text-sm">{t('scanner.initializingCamera')}</p>
                </div>
              </div>
            )}

            {/* Detected barcode display */}
            {detectedBarcode && (
              <div className="absolute bottom-4 left-4 right-4 p-3 bg-green-500/90 rounded-md">
                <p className="text-sm text-white font-medium text-center">
                  {t('scanner.detected')}: {detectedBarcode}
                </p>
              </div>
            )}
          </div>

          <Group justify="flex-end" gap="xs">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              leftSection={<X size={16} />}
            >
              {t('common.cancel')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};
