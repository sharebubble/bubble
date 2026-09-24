import { useLanguage } from '@/contexts/LanguageContext';
import { shortHash } from '@/lib/ledger';
import { Button, Code, CopyButton, Group } from '@mantine/core';
import { Copy } from 'lucide-react';

/** A hash in monospace with a copy button; the full value is in the tooltip. */
export const HashValue = ({ hash }: { hash: string }) => {
  const { t } = useLanguage();
  return (
    <Group gap={4} wrap="nowrap">
      <Code title={hash}>{shortHash(hash)}</Code>
      <CopyButton value={hash}>
        {({ copied, copy }) => (
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={copy}
            aria-label={t('ledger.chain.copy')}
            className="print-hide"
          >
            {copied ? t('ledger.chain.copied') : <Copy size={12} aria-hidden="true" />}
          </Button>
        )}
      </CopyButton>
    </Group>
  );
};
