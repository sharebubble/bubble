import { BackButton } from '@/components/layout/BackButton';
import { CostShareModal } from '@/components/ledger/CostShareModal';
import { ReceiptList } from '@/components/ledger/ReceiptList';
import { TextPromptModal } from '@/components/ledger/TextPromptModal';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  useAddCostShareReceipt,
  useCancelCostShare,
  useLedgerCostShare,
  useMyLedgerAccount,
  useRespondToCostShare,
} from '@/hooks/useLedger';
import { formatMoney } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import {
  COST_SHARE_STATE_COLORS,
  RECEIPT_TYPES,
  RESPONSE_COLORS,
  categoryLabel,
  firstError,
  myShare,
} from '@/lib/ledger';
import { ledgerAccountPath, ledgerTransactionPath } from '@/lib/routes';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  FileButton,
  Group,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { Check, Clock, Paperclip, Pencil, X } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

/**
 * One shared expense: who pays what, who answered, and — once booked — the
 * transaction. Participants accept or object here; the payer edits or
 * withdraws it while it is open.
 */
const LedgerCostShare = () => {
  const { costShareId } = useParams<{ costShareId: string }>();
  const { t, language } = useLanguage();
  const { data: costShare, isLoading, isError } = useLedgerCostShare(costShareId);
  const { data: me } = useMyLedgerAccount();
  const respond = useRespondToCostShare();
  const cancel = useCancelCostShare();
  const addReceipt = useAddCostShareReceipt();
  const [objectOpened, { open: openObject, close: closeObject }] = useDisclosure(false);
  const [cancelOpened, { open: openCancel, close: closeCancel }] = useDisclosure(false);
  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure(false);

  if (isLoading) {
    return (
      <Text c="dimmed" className="py-8 text-center">
        {t('common.loading')}
      </Text>
    );
  }
  if (isError || !costShare) {
    return (
      <Text c="red" className="py-8 text-center">
        {t('common.loadingError')}
      </Text>
    );
  }

  const money = (value: string | number) => formatMoney(value, costShare.currency, language);
  const isOpen = costShare.state === 'open';
  const share = myShare(costShare, me);
  const canCancel = isOpen && (costShare.is_payer || !!me?.is_ledger_admin);
  const showError = (err: unknown) =>
    notifications.show({ color: 'red', message: firstError(err, t('ledger.postFailed')) });

  return (
    <main className="container mx-auto max-w-3xl px-4 py-4">
      <Stack gap="md">
        <Group gap="sm" wrap="nowrap">
          <BackButton />
          <Title order={1} size="h3" className="min-w-0">
            {costShare.description}
          </Title>
        </Group>

        <Card withBorder>
          <Stack gap="xs">
            <Group justify="space-between">
              <Text size="xl" fw={700}>
                {money(costShare.total)}
              </Text>
              <Group gap="xs">
                <Badge variant="light" color={COST_SHARE_STATE_COLORS[costShare.state]}>
                  {t(`ledger.split.state.${costShare.state}`)}
                </Badge>
                <Badge variant="outline">{t(`ledger.split.${costShare.split}`)}</Badge>
                {costShare.category && (
                  <Badge variant="default">{categoryLabel(costShare.category, t)}</Badge>
                )}
                {costShare.project && <Badge variant="default">{costShare.project.name}</Badge>}
              </Group>
            </Group>
            <Text size="sm">
              {t('ledger.split.paidByPrefix')}{' '}
              <Anchor component={Link} to={ledgerAccountPath(costShare.payer.id)}>
                {costShare.payer.name}
              </Anchor>{' '}
              · {t('ledger.date')}: {formatDate(costShare.occurred_on, language)}
            </Text>
            {share !== undefined && (
              <Text size="sm" fw={500}>
                {t('ledger.split.yourShare', { amount: money(share) })}
              </Text>
            )}
            {isOpen && (
              <Text size="sm" c="dimmed" className="inline-flex items-center gap-1">
                <Clock size={14} aria-hidden="true" />
                {t('ledger.split.deadline', {
                  date: formatDate(costShare.auto_accept_at, language),
                })}
              </Text>
            )}
            {costShare.posted_transaction && (
              <Text size="sm">
                <Anchor component={Link} to={ledgerTransactionPath(costShare.posted_transaction)}>
                  {t('ledger.split.viewTransaction')}
                </Anchor>
              </Text>
            )}
            {costShare.state === 'cancelled' && costShare.cancelled_reason && (
              <Text size="sm" c="dimmed">
                {t('ledger.split.cancelledBecause', { reason: costShare.cancelled_reason })}
              </Text>
            )}
          </Stack>
        </Card>

        {isOpen && costShare.my_response === 'pending' && (
          <Alert color="orange" title={t('ledger.split.answerTitle')}>
            <Stack gap="sm">
              <Text size="sm">
                {t('ledger.split.answerBody', {
                  amount: money(share ?? '0'),
                  date: formatDate(costShare.auto_accept_at, language),
                })}
              </Text>
              <Group gap="xs">
                <Button
                  leftSection={<Check size={16} aria-hidden="true" />}
                  loading={respond.isPending}
                  onClick={() =>
                    respond.mutate({ id: costShare.id, accept: true }, { onError: showError })
                  }
                >
                  {t('ledger.split.accept')}
                </Button>
                <Button
                  variant="default"
                  leftSection={<X size={16} aria-hidden="true" />}
                  onClick={openObject}
                >
                  {t('ledger.split.object')}
                </Button>
              </Group>
            </Stack>
          </Alert>
        )}

        <Card withBorder padding="sm">
          <Title order={2} size="h5" mb="xs">
            {t('ledger.split.participants')}
          </Title>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('ledger.split.member')}</Table.Th>
                <Table.Th>{t('ledger.split.answer')}</Table.Th>
                <Table.Th className="text-right">{t('ledger.split.share')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {costShare.participants.map(participant => (
                <Table.Tr key={participant.id}>
                  <Table.Td>
                    <Text size="sm">{participant.account.name}</Text>
                    {participant.guests > 0 && (
                      <Text size="xs" c="dimmed">
                        {t('ledger.split.withGuests', { count: participant.guests })}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Badge size="sm" variant="light" color={RESPONSE_COLORS[participant.response]}>
                      {t(`ledger.split.response.${participant.response}`)}
                    </Badge>
                    {participant.objection_reason && (
                      <Text size="xs" c="dimmed" className="whitespace-pre-line">
                        {participant.objection_reason}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td className="text-right">
                    <Text
                      size="sm"
                      fw={600}
                      td={participant.response === 'objected' ? 'line-through' : undefined}
                    >
                      {money(participant.share)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
              <Table.Tr>
                <Table.Td>
                  <Text size="sm">{costShare.payer.name}</Text>
                  <Text size="xs" c="dimmed">
                    {t('ledger.split.payer')}
                  </Text>
                </Table.Td>
                <Table.Td />
                <Table.Td className="text-right">
                  <Text size="sm" c="dimmed">
                    {money(costShare.payer_share)}
                  </Text>
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
          {costShare.participants.some(p => p.response === 'objected') && (
            <Text size="xs" c="dimmed" mt="xs">
              {t('ledger.split.objectedHelp')}
            </Text>
          )}
        </Card>

        <Card withBorder padding="sm">
          <Group justify="space-between" mb="xs">
            <Title order={2} size="h5">
              {t('ledger.receipts')}
            </Title>
            {costShare.is_payer && (
              <FileButton
                accept={RECEIPT_TYPES}
                onChange={file =>
                  file && addReceipt.mutate({ id: costShare.id, file }, { onError: showError })
                }
              >
                {props => (
                  <Button
                    {...props}
                    size="xs"
                    variant="default"
                    loading={addReceipt.isPending}
                    leftSection={<Paperclip size={14} aria-hidden="true" />}
                  >
                    {t('ledger.split.addReceipt')}
                  </Button>
                )}
              </FileButton>
            )}
          </Group>
          <ReceiptList receipts={costShare.receipts} />
        </Card>

        {(costShare.is_payer || canCancel) && isOpen && (
          <Group gap="xs">
            {costShare.is_payer && (
              <Button
                variant="default"
                leftSection={<Pencil size={16} aria-hidden="true" />}
                onClick={openEdit}
              >
                {t('ledger.split.edit')}
              </Button>
            )}
            {canCancel && (
              <Button variant="default" color="red" onClick={openCancel}>
                {t('ledger.split.cancel')}
              </Button>
            )}
          </Group>
        )}
      </Stack>

      <TextPromptModal
        opened={objectOpened}
        onClose={closeObject}
        title={t('ledger.split.objectTitle')}
        body={t('ledger.split.objectBody')}
        label={t('ledger.split.objectReason')}
        confirm={t('ledger.split.object')}
        color="red"
        loading={respond.isPending}
        onSubmit={reason => respond.mutateAsync({ id: costShare.id, accept: false, reason })}
        errorMessage={err => firstError(err, t('ledger.postFailed'))}
      />
      <TextPromptModal
        opened={cancelOpened}
        onClose={closeCancel}
        title={t('ledger.split.cancelTitle')}
        body={t('ledger.split.cancelBody')}
        label={t('ledger.split.cancelReason')}
        confirm={t('ledger.split.cancel')}
        color="red"
        optional
        loading={cancel.isPending}
        onSubmit={reason => cancel.mutateAsync({ id: costShare.id, reason })}
        errorMessage={err => firstError(err, t('ledger.postFailed'))}
      />
      {me && costShare.is_payer && isOpen && (
        <CostShareModal opened={editOpened} onClose={closeEdit} me={me} costShare={costShare} />
      )}
    </main>
  );
};

export default LedgerCostShare;
