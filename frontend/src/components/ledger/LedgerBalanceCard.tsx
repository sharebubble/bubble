import { useLanguage } from '@/contexts/LanguageContext';
import { formatMoney } from '@/lib/currency';
import type { LedgerAccount, LedgerMyAccount } from '@/services/django';
import { Alert, Card, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { AlertTriangle, ChevronRight, Wallet } from 'lucide-react';

interface LedgerBalanceCardProps {
  account: LedgerAccount | LedgerMyAccount;
  /** Phrase it as "you" rather than with the member's name. */
  isMe?: boolean;
  onClick?: () => void;
}

/**
 * A member's balance, stated in plain words: who owes whom how much.
 *
 * A member balance is positive when the community owes the member money
 * (they paid for something, or topped up) and negative when they owe it.
 */
export const LedgerBalanceCard = ({ account, isMe = false, onClick }: LedgerBalanceCardProps) => {
  const { t, language } = useLanguage();
  const balance = Number(account.balance);
  const amount = formatMoney(Math.abs(balance), account.currency, language);
  const who = isMe ? 'Me' : 'Member';
  const sentence =
    balance > 0
      ? t(`ledger.balance.owed${who}`, { amount, name: account.name })
      : balance < 0
        ? t(`ledger.balance.owes${who}`, { amount, name: account.name })
        : t(`ledger.balance.square${who}`, { name: account.name });
  const belowSoftLimit = 'below_soft_limit' in account && account.below_soft_limit;

  const content = (
    <Group justify="space-between" wrap="nowrap">
      <Group gap="sm" wrap="nowrap">
        <Wallet size={24} aria-hidden="true" />
        <Stack gap={0}>
          <Text size="sm" c="dimmed">
            {isMe ? t('ledger.myBalance') : account.name}
          </Text>
          <Text
            fw={700}
            size="xl"
            c={balance < 0 ? 'red' : balance > 0 ? 'green' : undefined}
            data-testid="ledger-balance"
          >
            {formatMoney(balance, account.currency, language, { signed: true })}
          </Text>
          <Text size="sm">{sentence}</Text>
        </Stack>
      </Group>
      {onClick && <ChevronRight size={16} aria-hidden="true" />}
    </Group>
  );

  return (
    <Card withBorder>
      <Stack gap="sm">
        {onClick ? (
          <UnstyledButton onClick={onClick} aria-label={t('ledger.openMyAccount')}>
            {content}
          </UnstyledButton>
        ) : (
          content
        )}
        {belowSoftLimit && (
          <Alert
            color="orange"
            icon={<AlertTriangle size={16} aria-hidden="true" />}
            title={t('ledger.softLimitTitle')}
          >
            {t('ledger.softLimitBody', {
              limit: formatMoney(
                (account as LedgerMyAccount).soft_limit,
                account.currency,
                language,
              ),
            })}
          </Alert>
        )}
      </Stack>
    </Card>
  );
};
