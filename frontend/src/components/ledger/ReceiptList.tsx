import { useLanguage } from '@/contexts/LanguageContext';
import { useDownloadReceipt } from '@/hooks/useLedger';
import type { LedgerReceipt } from '@/services/django';
import { Button, Code, Group, Stack, Text } from '@mantine/core';
import { Download, Paperclip } from 'lucide-react';

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Receipt files with their fingerprint; downloads go through the logged endpoint. */
export const ReceiptList = ({ receipts }: { receipts: LedgerReceipt[] }) => {
  const { t } = useLanguage();
  const download = useDownloadReceipt();

  if (receipts.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        {t('ledger.noReceipts')}
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      {receipts.map(receipt => (
        <Group key={receipt.id} justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" className="min-w-0">
            <Paperclip size={16} aria-hidden="true" className="shrink-0" />
            <div className="min-w-0">
              <Text size="sm" truncate>
                {receipt.file_name} · {formatSize(receipt.size)}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                SHA-256 <Code>{receipt.sha256}</Code>
              </Text>
            </div>
          </Group>
          <Button
            size="xs"
            variant="default"
            leftSection={<Download size={14} aria-hidden="true" />}
            onClick={() => download.mutate({ id: receipt.id, fileName: receipt.file_name })}
          >
            {t('ledger.download')}
          </Button>
        </Group>
      ))}
      <Text size="xs" c="dimmed">
        {t('ledger.receiptAccessLogged')}
      </Text>
    </Stack>
  );
};
