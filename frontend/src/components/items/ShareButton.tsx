import { useLanguage } from '@/contexts/LanguageContext';
import { useShare } from '@/hooks/useShare';
import { ActionIcon, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Check, Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface ShareButtonProps {
  /** Link to share. Defaults to the current page URL. */
  url?: string;
  title?: string;
  text?: string;
}

/**
 * Compact share action: opens the native share sheet on mobile, copies the
 * link to the clipboard (with a confirmation notification) everywhere else.
 */
export function ShareButton({ url, title, text }: ShareButtonProps) {
  const { t } = useLanguage();
  const { share, canShareNatively } = useShare();
  const [copied, setCopied] = useState(false);
  const copiedTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(copiedTimeout.current), []);

  const label = canShareNatively ? t('share.share') : t('share.copyLink');

  const handleShare = async () => {
    const outcome = await share({
      url: url ?? window.location.href,
      ...(title ? { title } : {}),
      ...(text ? { text } : {}),
    });

    if (outcome === 'copied') {
      notifications.show({ message: t('share.copied'), color: 'green' });
      setCopied(true);
      clearTimeout(copiedTimeout.current);
      copiedTimeout.current = setTimeout(() => setCopied(false), 2000);
    } else if (outcome === 'error') {
      notifications.show({ message: t('share.failed'), color: 'red' });
    }
  };

  return (
    <Tooltip label={copied ? t('share.copied') : label}>
      <ActionIcon
        variant={copied ? 'filled' : 'light'}
        color={copied ? 'green' : undefined}
        size="lg"
        aria-label={label}
        data-testid="share-button"
        onClick={() => void handleShare()}
      >
        {copied ? <Check size={18} /> : <Share2 size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}
