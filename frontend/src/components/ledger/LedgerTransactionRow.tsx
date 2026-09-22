import { useLanguage } from '@/contexts/LanguageContext';
import { formatMoney } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import { categoryLabel, hasOwnCategory } from '@/lib/ledger';
import { ledgerTransactionPath } from '@/lib/routes';
import type { LedgerTransaction } from '@/services/django';
import { Badge, Card, Group, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { Paperclip, Undo2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/** Kinds where a missing receipt is worth pointing out (plan section 7). */
const RECEIPT_EXPECTED = new Set(['member_expense', 'shared_expense']);

/** Who was credited or charged, from each member's point of view. */
export const MemberEffects = ({ transaction }: { transaction: LedgerTransaction }) => {
  const { language } = useLanguage();
  const effects = transaction.entries.filter(entry => entry.account.type === 'member');
  if (effects.length === 0) return null;

  return (
    <Group gap="xs">
      {effects.map(entry => {
        const value = Number(entry.display_amount);
        return (
          <Badge key={entry.id} variant="light" color={value < 0 ? 'red' : 'green'}>
            {entry.account.name}{' '}
            {formatMoney(value, transaction.currency, language, { signed: true })}
          </Badge>
        );
      })}
    </Group>
  );
};

/** One transaction in the community feed; opens its detail page. */
export const LedgerTransactionRow = ({ transaction }: { transaction: LedgerTransaction }) => {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const missingReceipt = RECEIPT_EXPECTED.has(transaction.kind) && transaction.receipt_count === 0;
  const provenance = transaction.created_by
    ? t('ledger.enteredBy', { name: transaction.created_by.name })
    : t('ledger.postedAutomatically');

  return (
    <Card withBorder padding="sm">
      <UnstyledButton
        onClick={() => navigate(ledgerTransactionPath(transaction.id))}
        className="w-full"
        aria-label={transaction.description}
      >
        <Stack gap={6}>
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <div className="min-w-0">
              <Text fw={600} lineClamp={2}>
                {transaction.description}
              </Text>
              <Text size="xs" c="dimmed">
                #{transaction.seq} · {formatDate(transaction.occurred_on, language)} · {provenance}
              </Text>
            </div>
            <Text fw={700} className="shrink-0">
              {formatMoney(transaction.amount, transaction.currency, language)}
            </Text>
          </Group>
          <Group gap="xs">
            <Badge variant="outline">{t(`ledger.kind.${transaction.kind}`)}</Badge>
            {hasOwnCategory(transaction) && (
              <Badge variant="default">{categoryLabel(transaction.category!, t)}</Badge>
            )}
            {transaction.project && <Badge variant="default">{transaction.project.name}</Badge>}
            {transaction.receipt_count > 0 && (
              <Tooltip label={t('ledger.hasReceipt')}>
                <Paperclip size={14} aria-label={t('ledger.hasReceipt')} />
              </Tooltip>
            )}
            {missingReceipt && (
              <Badge variant="light" color="orange">
                {t('ledger.noReceipt')}
              </Badge>
            )}
            {transaction.reversed_by.length > 0 && (
              <Badge variant="light" color="gray" leftSection={<Undo2 size={12} />}>
                {t('ledger.corrected')}
              </Badge>
            )}
          </Group>
          <MemberEffects transaction={transaction} />
        </Stack>
      </UnstyledButton>
    </Card>
  );
};
