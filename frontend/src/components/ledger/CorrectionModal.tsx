import { useLanguage } from '@/contexts/LanguageContext';
import { useCorrectTransaction, useReverseTransaction } from '@/hooks/useLedger';
import { formatMoney } from '@/lib/currency';
import { firstError } from '@/lib/ledger';
import { ledgerTransactionPath } from '@/lib/routes';
import type { LedgerTransactionDetail } from '@/services/django';
import {
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Textarea,
} from '@mantine/core';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface CorrectionModalProps {
  opened: boolean;
  onClose: () => void;
  transaction: LedgerTransactionDetail;
}

/**
 * Undo a transaction with a new one: everything that is left (a reversal) or
 * part of it (a correction, e.g. one participant's share). The original is
 * never changed.
 */
export const CorrectionModal = ({ opened, onClose, transaction }: CorrectionModalProps) => {
  const { t } = useLanguage();
  return (
    <Modal opened={opened} onClose={onClose} title={t('ledger.fix.title')} size="lg">
      <CorrectionForm onClose={onClose} transaction={transaction} />
    </Modal>
  );
};

const cents = (value: number) => Math.round(value * 100);

const CorrectionForm = ({ onClose, transaction }: Omit<CorrectionModalProps, 'opened'>) => {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const reverse = useReverseTransaction();
  const correct = useCorrectTransaction();
  const [mode, setMode] = useState<'reverse' | 'correct'>('reverse');
  const [description, setDescription] = useState('');
  const [amounts, setAmounts] = useState<Record<string, number | string>>({});
  const [error, setError] = useState<string | null>(null);

  const money = (value: number | string, signed = false) =>
    formatMoney(value, transaction.currency, language, { signed });
  // Only lines with something left can be undone.
  const lines = transaction.entries.filter(entry => Number(transaction.remaining[entry.id]) !== 0);
  // Raw amounts are debit-positive; a line gives back in the direction of what is left.
  const signedTotal = lines.reduce((sum, entry) => {
    const value = Number(amounts[entry.id] || 0);
    return sum + Math.sign(Number(transaction.remaining[entry.id])) * cents(value);
  }, 0);
  const anything = lines.some(entry => Number(amounts[entry.id] || 0) > 0);
  const balanced = signedTotal === 0;

  const submit = async () => {
    setError(null);
    try {
      const result =
        mode === 'reverse'
          ? await reverse.mutateAsync({ id: transaction.id, description })
          : await correct.mutateAsync({
              id: transaction.id,
              description,
              lines: lines
                .filter(entry => Number(amounts[entry.id] || 0) > 0)
                .map(entry => ({ entry: entry.id, amount: Number(amounts[entry.id]).toFixed(2) })),
            });
      onClose();
      navigate(ledgerTransactionPath(result.id));
    } catch (err) {
      setError(firstError(err, t('ledger.postFailed')));
    }
  };

  return (
    <Stack gap="sm">
      <SegmentedControl
        value={mode}
        onChange={value => setMode(value as 'reverse' | 'correct')}
        data={[
          { value: 'reverse', label: t('ledger.fix.reverse') },
          { value: 'correct', label: t('ledger.fix.correct') },
        ]}
      />
      <Text size="sm" c="dimmed">
        {mode === 'reverse' ? t('ledger.fix.reverseHelp') : t('ledger.fix.correctHelp')}
      </Text>

      {mode === 'correct' && (
        <>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('ledger.account')}</Table.Th>
                <Table.Th className="text-right">{t('ledger.fix.left')}</Table.Th>
                <Table.Th className="w-36">{t('ledger.fix.undo')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines.map(entry => {
                const left = Number(transaction.remaining[entry.id]);
                // What is left, as the effect a reader sees on that account.
                const shown = (left / Number(entry.amount)) * Number(entry.display_amount);
                return (
                  <Table.Tr key={entry.id}>
                    <Table.Td>
                      <Text size="sm">{entry.account.name}</Text>
                      <Text size="xs" c="dimmed">
                        {t(`ledger.accountType.${entry.account.type}`)}
                      </Text>
                    </Table.Td>
                    <Table.Td className="text-right">
                      <Text size="sm">{money(shown, true)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <NumberInput
                        aria-label={t('ledger.fix.undoFor', { name: entry.account.name })}
                        value={amounts[entry.id] ?? ''}
                        onChange={value => setAmounts(prev => ({ ...prev, [entry.id]: value }))}
                        min={0}
                        max={Math.abs(left)}
                        decimalScale={2}
                        decimalSeparator={language === 'de' ? ',' : '.'}
                        size="xs"
                      />
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
          {anything && !balanced && (
            <Alert color="orange">
              {t('ledger.fix.unbalanced', { amount: money(Math.abs(signedTotal) / 100) })}
            </Alert>
          )}
        </>
      )}

      <Textarea
        label={t('ledger.fix.why')}
        placeholder={t('ledger.fix.whyPlaceholder')}
        value={description}
        onChange={event => setDescription(event.currentTarget.value)}
        maxLength={2000}
        autosize
        minRows={2}
      />
      {error && <Alert color="red">{error}</Alert>}
      <Text size="xs" c="dimmed">
        {t('ledger.publicNotice')}
      </Text>
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          color={mode === 'reverse' ? 'red' : undefined}
          onClick={() => void submit()}
          loading={reverse.isPending || correct.isPending}
          disabled={mode === 'correct' && (!anything || !balanced)}
        >
          {mode === 'reverse' ? t('ledger.fix.reverseConfirm') : t('ledger.fix.correctConfirm')}
        </Button>
      </Group>
    </Stack>
  );
};
