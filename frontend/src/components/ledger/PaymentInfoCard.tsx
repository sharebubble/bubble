import { useLanguage } from '@/contexts/LanguageContext';
import type { LedgerMyAccount } from '@/services/django';
import { Button, Card, CopyButton, Group, Stack, Text, Title } from '@mantine/core';
import { Check, Copy } from 'lucide-react';

const CopyRow = ({ label, value }: { label: string; value: string }) => {
  const { t } = useLanguage();
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <div className="min-w-0">
        <Text size="xs" c="dimmed">
          {label}
        </Text>
        <Text fw={600} className="break-words font-mono">
          {value}
        </Text>
      </div>
      <CopyButton value={value}>
        {({ copied, copy }) => (
          <Button
            size="compact-sm"
            variant="default"
            onClick={copy}
            className="shrink-0"
            leftSection={copied ? <Check size={14} /> : <Copy size={14} />}
            aria-label={`${t('ledger.pay.copy')}: ${label}`}
          >
            {copied ? t('ledger.chain.copied') : t('ledger.pay.copy')}
          </Button>
        )}
      </CopyButton>
    </Group>
  );
};

/**
 * How to pay money in by bank transfer: the community's IBAN and the
 * member's own payment reference, which lets the treasurer's bank import
 * book the transfer to the right account (plan section 12).
 */
export const PaymentInfoCard = ({ account }: { account: LedgerMyAccount }) => {
  const { t } = useLanguage();
  if (!account.payment_reference) return null;
  return (
    <Card withBorder>
      <Stack gap="xs">
        <Title order={2} size="h5">
          {t('ledger.pay.title')}
        </Title>
        <Text size="sm" c="dimmed">
          {t('ledger.pay.help')}
        </Text>
        {account.community_iban && (
          <CopyRow
            label={
              account.community_account_holder
                ? `${t('ledger.pay.iban')} · ${account.community_account_holder}`
                : t('ledger.pay.iban')
            }
            value={account.community_iban}
          />
        )}
        <CopyRow label={t('ledger.pay.reference')} value={account.payment_reference} />
      </Stack>
    </Card>
  );
};
