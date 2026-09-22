import { BackButton } from '@/components/layout/BackButton';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDownloadReceipt, useLedgerTransaction } from '@/hooks/useLedger';
import { formatMoney } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import { categoryLabel, hasOwnCategory } from '@/lib/ledger';
import { ledgerAccountPath, ledgerTransactionPath } from '@/lib/routes';
import { Anchor, Badge, Button, Card, Code, Group, Stack, Table, Text, Title } from '@mantine/core';
import { Download, Paperclip } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * One transaction with both sides of every entry, its receipts and its links
 * to corrections. Nothing here can be edited: corrections are new transactions.
 */
const LedgerTransaction = () => {
  const { transactionId } = useParams<{ transactionId: string }>();
  const { t, language } = useLanguage();
  const { data: transaction, isLoading, isError } = useLedgerTransaction(transactionId);
  const download = useDownloadReceipt();

  if (isLoading) {
    return (
      <Text c="dimmed" className="py-8 text-center">
        {t('common.loading')}
      </Text>
    );
  }
  if (isError || !transaction) {
    return (
      <Text c="red" className="py-8 text-center">
        {t('common.loadingError')}
      </Text>
    );
  }

  const money = (value: string, signed = false) =>
    formatMoney(value, transaction.currency, language, { signed });

  return (
    <main className="container mx-auto max-w-3xl px-4 py-4">
      <Stack gap="md">
        <Group gap="sm" wrap="nowrap">
          <BackButton />
          <Title order={1} size="h3" className="min-w-0">
            {transaction.description}
          </Title>
        </Group>

        <Card withBorder>
          <Stack gap="xs">
            <Group justify="space-between">
              <Text size="xl" fw={700}>
                {money(transaction.amount)}
              </Text>
              <Group gap="xs">
                <Badge variant="outline">{t(`ledger.kind.${transaction.kind}`)}</Badge>
                {hasOwnCategory(transaction) && (
                  <Badge variant="default">{categoryLabel(transaction.category!, t)}</Badge>
                )}
                {transaction.project && <Badge variant="default">{transaction.project.name}</Badge>}
              </Group>
            </Group>
            <Text size="sm" c="dimmed">
              #{transaction.seq} · {t('ledger.date')}:{' '}
              {formatDate(transaction.occurred_on, language)}
            </Text>
            <Text size="sm">
              {transaction.created_by ? (
                <>
                  {t('ledger.enteredByPrefix')}{' '}
                  <Anchor component={Link} to={ledgerAccountPath(transaction.created_by.id)}>
                    {transaction.created_by.name}
                  </Anchor>{' '}
                  · {formatDate(transaction.created_at, language)}
                </>
              ) : (
                t('ledger.postedAutomatically')
              )}
            </Text>
            {transaction.reverses && (
              <Text size="sm">
                {t('ledger.corrects')}{' '}
                <Anchor component={Link} to={ledgerTransactionPath(transaction.reverses)}>
                  {t('ledger.originalTransaction')}
                </Anchor>
              </Text>
            )}
            {transaction.reversed_by.map(id => (
              <Text size="sm" key={id}>
                {t('ledger.correctedBy')}{' '}
                <Anchor component={Link} to={ledgerTransactionPath(id)}>
                  {t('ledger.correction')}
                </Anchor>
              </Text>
            ))}
          </Stack>
        </Card>

        <Card withBorder padding="sm">
          <Title order={2} size="h5" mb="xs">
            {t('ledger.entries')}
          </Title>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('ledger.account')}</Table.Th>
                <Table.Th className="text-right">{t('ledger.effect')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {transaction.entries.map(entry => {
                const value = Number(entry.display_amount);
                const isMember = entry.account.type === 'member';
                return (
                  <Table.Tr key={entry.id}>
                    <Table.Td>
                      <Anchor component={Link} to={ledgerAccountPath(entry.account.id)}>
                        {entry.account.name}
                      </Anchor>
                      <Text size="xs" c="dimmed">
                        {t(`ledger.accountType.${entry.account.type}`)}
                      </Text>
                    </Table.Td>
                    <Table.Td className="text-right">
                      <Text fw={600} c={isMember ? (value < 0 ? 'red' : 'green') : undefined}>
                        {money(entry.display_amount, true)}
                      </Text>
                      {isMember && (
                        <Text size="xs" c="dimmed">
                          {value > 0 ? t('ledger.credited') : t('ledger.charged')}
                        </Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Card>

        <Card withBorder padding="sm">
          <Title order={2} size="h5" mb="xs">
            {t('ledger.receipts')}
          </Title>
          {transaction.receipts.length === 0 ? (
            <Text size="sm" c="dimmed">
              {t('ledger.noReceipts')}
            </Text>
          ) : (
            <Stack gap="xs">
              {transaction.receipts.map(receipt => (
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
          )}
        </Card>
      </Stack>
    </main>
  );
};

export default LedgerTransaction;
