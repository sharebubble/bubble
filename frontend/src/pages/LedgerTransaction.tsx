import { BackButton } from '@/components/layout/BackButton';
import { CorrectionModal } from '@/components/ledger/CorrectionModal';
import { ReceiptList } from '@/components/ledger/ReceiptList';
import { TextPromptModal } from '@/components/ledger/TextPromptModal';
import {
  TransactionComments,
  TransactionDisputes,
} from '@/components/ledger/TransactionDiscussion';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDisputeTransaction, useLedgerTransaction, useMyLedgerAccount } from '@/hooks/useLedger';
import { formatMoney } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import { categoryLabel, firstError, hasOwnCategory } from '@/lib/ledger';
import { ledgerAccountPath, ledgerCostSharePath, ledgerTransactionPath } from '@/lib/routes';
import { Anchor, Badge, Button, Card, Group, Stack, Table, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Flag, Undo2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

/**
 * One transaction with both sides of every entry, its receipts, disputes and
 * discussion. Nothing here is edited: a reversal or correction is a new
 * transaction linked to this one.
 */
const LedgerTransaction = () => {
  const { transactionId } = useParams<{ transactionId: string }>();
  const { t, language } = useLanguage();
  const { data: transaction, isLoading, isError } = useLedgerTransaction(transactionId);
  const { data: me } = useMyLedgerAccount();
  const dispute = useDisputeTransaction();
  const [disputeOpened, { open: openDispute, close: closeDispute }] = useDisclosure(false);
  const [fixOpened, { open: openFix, close: closeFix }] = useDisclosure(false);

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
  const somethingLeft = Object.values(transaction.remaining).some(value => Number(value) !== 0);
  const alreadyDisputed = transaction.disputes.some(
    item => item.state === 'open' && item.raised_by.id === me?.id,
  );

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
            {transaction.cost_share && (
              <Text size="sm">
                <Anchor component={Link} to={ledgerCostSharePath(transaction.cost_share)}>
                  {t('ledger.split.viewSplit')}
                </Anchor>
              </Text>
            )}
            <Group gap="xs" mt="xs">
              {!alreadyDisputed && (
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<Flag size={14} aria-hidden="true" />}
                  onClick={openDispute}
                >
                  {t('ledger.dispute.raise')}
                </Button>
              )}
              {transaction.can_reverse && somethingLeft && (
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<Undo2 size={14} aria-hidden="true" />}
                  onClick={openFix}
                >
                  {t('ledger.fix.button')}
                </Button>
              )}
            </Group>
          </Stack>
        </Card>

        <TransactionDisputes transaction={transaction} me={me} />

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
          <ReceiptList receipts={transaction.receipts} />
        </Card>

        <TransactionComments transaction={transaction} />
      </Stack>

      <TextPromptModal
        opened={disputeOpened}
        onClose={closeDispute}
        title={t('ledger.dispute.raiseTitle')}
        body={t('ledger.dispute.raiseBody')}
        label={t('ledger.dispute.reason')}
        placeholder={t('ledger.dispute.reasonPlaceholder')}
        confirm={t('ledger.dispute.raiseConfirm')}
        color="orange"
        loading={dispute.isPending}
        onSubmit={reason => dispute.mutateAsync({ id: transaction.id, reason })}
        errorMessage={err => firstError(err, t('ledger.postFailed'))}
      />
      {transaction.can_reverse && (
        <CorrectionModal opened={fixOpened} onClose={closeFix} transaction={transaction} />
      )}
    </main>
  );
};

export default LedgerTransaction;
