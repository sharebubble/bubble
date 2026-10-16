import { TextPromptModal } from '@/components/ledger/TextPromptModal';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCommentOnTransaction, useUpholdDispute, useWithdrawDispute } from '@/hooks/useLedger';
import { formatDate } from '@/lib/date';
import { firstError } from '@/lib/ledger';
import type {
  LedgerDispute,
  LedgerDisputeStateEnum,
  LedgerMyAccount,
  LedgerTransactionDetail,
} from '@/services/django';
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Flag, Send } from 'lucide-react';
import { Fragment, useState } from 'react';

const STATE_COLORS: Record<LedgerDisputeStateEnum, string> = {
  open: 'orange',
  withdrawn: 'gray',
  reversed: 'blue',
  corrected: 'blue',
  upheld: 'gray',
};

const DisputeRow = ({
  dispute,
  transaction,
  me,
}: {
  dispute: LedgerDispute;
  transaction: LedgerTransactionDetail;
  me?: LedgerMyAccount;
}) => {
  const { t, language } = useLanguage();
  const withdraw = useWithdrawDispute();
  const uphold = useUpholdDispute();
  const [upholdOpened, setUpholdOpened] = useState(false);
  const isOpen = dispute.state === 'open';
  const isMine = !!me && dispute.raised_by.id === me.id;

  return (
    <Stack gap={4}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Text size="sm">
          <Text span fw={600}>
            {dispute.raised_by.name}
          </Text>{' '}
          <Text span c="dimmed" size="xs">
            · {formatDate(dispute.created_at, language)}
          </Text>
        </Text>
        <Badge variant="light" color={STATE_COLORS[dispute.state]} className="shrink-0">
          {t(`ledger.dispute.state.${dispute.state}`)}
        </Badge>
      </Group>
      <Text size="sm" className="whitespace-pre-line">
        {dispute.reason}
      </Text>
      {dispute.resolution && (
        <Text size="sm" c="dimmed" className="whitespace-pre-line">
          {t('ledger.dispute.answer', { name: dispute.resolved_by?.name ?? '' })}{' '}
          {dispute.resolution}
        </Text>
      )}
      {isOpen && (isMine || transaction.can_reverse) && (
        <Group gap="xs">
          {isMine && (
            <Button
              size="xs"
              variant="default"
              loading={withdraw.isPending}
              onClick={() =>
                withdraw.mutate(dispute.id, {
                  onError: err =>
                    notifications.show({
                      color: 'red',
                      message: firstError(err, t('ledger.postFailed')),
                    }),
                })
              }
            >
              {t('ledger.dispute.withdraw')}
            </Button>
          )}
          {transaction.can_reverse && (
            <Button size="xs" variant="default" onClick={() => setUpholdOpened(true)}>
              {t('ledger.dispute.keep')}
            </Button>
          )}
        </Group>
      )}
      <TextPromptModal
        opened={upholdOpened}
        onClose={() => setUpholdOpened(false)}
        title={t('ledger.dispute.keepTitle')}
        body={t('ledger.dispute.keepBody')}
        label={t('ledger.dispute.keepLabel')}
        confirm={t('ledger.dispute.keepConfirm')}
        loading={uphold.isPending}
        onSubmit={resolution => uphold.mutateAsync({ id: dispute.id, resolution })}
        errorMessage={err => firstError(err, t('ledger.postFailed'))}
      />
    </Stack>
  );
};

/** Open and closed disputes, with the answers they got. */
export const TransactionDisputes = ({
  transaction,
  me,
}: {
  transaction: LedgerTransactionDetail;
  me?: LedgerMyAccount;
}) => {
  const { t } = useLanguage();
  if (transaction.disputes.length === 0) return null;
  const open = transaction.disputes.some(dispute => dispute.state === 'open');

  return (
    <Card withBorder padding="sm">
      <Group gap="xs" mb="xs">
        <Flag size={16} aria-hidden="true" />
        <Title order={2} size="h5">
          {t('ledger.dispute.title')}
        </Title>
      </Group>
      {open && transaction.can_reverse && (
        <Alert color="orange" mb="sm">
          {t('ledger.dispute.youCanAnswer')}
        </Alert>
      )}
      <Stack gap="sm">
        {transaction.disputes.map((dispute, index) => (
          <Fragment key={dispute.id}>
            {index > 0 && <Divider />}
            <DisputeRow dispute={dispute} transaction={transaction} me={me} />
          </Fragment>
        ))}
      </Stack>
    </Card>
  );
};

/** The discussion under a transaction. Comments are never edited. */
export const TransactionComments = ({ transaction }: { transaction: LedgerTransactionDetail }) => {
  const { t, language } = useLanguage();
  const comment = useCommentOnTransaction();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setError(null);
    try {
      await comment.mutateAsync({ id: transaction.id, body: body.trim() });
      setBody('');
    } catch (err) {
      setError(firstError(err, t('ledger.postFailed')));
    }
  };

  return (
    <Card withBorder padding="sm">
      <Title order={2} size="h5" mb="xs">
        {t('ledger.comments.title')}
      </Title>
      <Stack gap="sm">
        {transaction.comments.length === 0 && (
          <Text size="sm" c="dimmed">
            {t('ledger.comments.empty')}
          </Text>
        )}
        {transaction.comments.map(item => (
          <div key={item.id}>
            <Text size="sm">
              <Text span fw={600}>
                {item.author.name}
              </Text>{' '}
              <Text span c="dimmed" size="xs">
                · {formatDate(item.created_at, language)}
              </Text>
            </Text>
            <Text size="sm" className="whitespace-pre-line">
              {item.body}
            </Text>
          </div>
        ))}
        <Textarea
          aria-label={t('ledger.comments.placeholder')}
          placeholder={t('ledger.comments.placeholder')}
          value={body}
          onChange={event => setBody(event.currentTarget.value)}
          maxLength={2000}
          autosize
          minRows={2}
          error={error}
        />
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            {t('ledger.comments.public')}
          </Text>
          <Button
            size="xs"
            leftSection={<Send size={14} aria-hidden="true" />}
            onClick={() => void send()}
            loading={comment.isPending}
            disabled={!body.trim()}
          >
            {t('ledger.comments.send')}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
};
