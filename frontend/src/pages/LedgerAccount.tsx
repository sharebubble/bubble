import { BackButton } from '@/components/layout/BackButton';
import { CostShareList } from '@/components/ledger/CostShareList';
import { LedgerBalanceCard } from '@/components/ledger/LedgerBalanceCard';
import { NewLedgerTransactionModal } from '@/components/ledger/NewLedgerTransactionModal';
import { PaymentInfoCard } from '@/components/ledger/PaymentInfoCard';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  useLedgerAccount,
  useLedgerAccountEntries,
  useLedgerCostShares,
  useMyLedgerAccount,
} from '@/hooks/useLedger';
import { formatMoney } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import {
  LEDGER_PATH,
  MY_STATEMENT_PATH,
  ledgerStatementPath,
  ledgerTransactionPath,
} from '@/lib/routes';
import {
  Anchor,
  Button,
  Card,
  Divider,
  Group,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Plus } from 'lucide-react';
import { Fragment } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

/**
 * A ledger account and its statement, newest first, with the balance after
 * each entry. `/ledger/me` shows the viewer's own; `/ledger/a/:accountId` any
 * other account — balances are public to members (D8).
 */
const LedgerAccount = () => {
  const { accountId } = useParams<{ accountId?: string }>();
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const { data: me } = useMyLedgerAccount();
  const isMe = !accountId || accountId === me?.id;
  const { data: other } = useLedgerAccount(isMe ? undefined : accountId);
  const account = isMe ? me : other;
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useLedgerAccountEntries(account?.id);
  const entries = data?.pages.flatMap(page => page.results) ?? [];
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
  const { data: waiting } = useLedgerCostShares({ waiting_for_me: true }, isMe);
  const { data: myOpenSplits } = useLedgerCostShares({ mine: true, state: 'open' }, isMe);
  const paidOpen = (myOpenSplits?.results ?? []).filter(costShare => costShare.is_payer);

  return (
    <main className="container mx-auto max-w-3xl px-4 py-4">
      <Stack gap="md">
        <Group justify="space-between">
          <Group gap="sm">
            <BackButton />
            <Title order={1} size="h3">
              {isMe ? t('ledger.myAccount') : (account?.name ?? t('ledger.account'))}
            </Title>
          </Group>
          {isMe && me && (
            <Button leftSection={<Plus size={16} aria-hidden="true" />} onClick={openModal}>
              {t('ledger.newTransaction')}
            </Button>
          )}
        </Group>

        {account && account.type === 'member' && (
          <LedgerBalanceCard account={account} isMe={isMe} />
        )}
        {account && account.type !== 'member' && (
          <Card withBorder>
            <Text size="sm" c="dimmed">
              {t(`ledger.accountType.${account.type}`)}
            </Text>
            <Text fw={700} size="xl">
              {formatMoney(account.balance, account.currency, language)}
            </Text>
          </Card>
        )}

        {isMe && me && <PaymentInfoCard account={me} />}

        {isMe && !!waiting?.results.length && (
          <Stack gap="xs">
            <Title order={2} size="h5">
              {t('ledger.split.waitingForYou')}
            </Title>
            <CostShareList costShares={waiting.results} me={me} />
          </Stack>
        )}
        {isMe && paidOpen.length > 0 && (
          <Stack gap="xs">
            <Title order={2} size="h5">
              {t('ledger.split.yourOpenSplits')}
            </Title>
            <CostShareList costShares={paidOpen} me={me} />
          </Stack>
        )}

        <Group justify="space-between">
          <Title order={2} size="h5">
            {t('ledger.statement')}
          </Title>
          <Group gap="md">
            {account && (
              <Anchor
                component={Link}
                to={isMe ? MY_STATEMENT_PATH : ledgerStatementPath(account.id)}
                size="sm"
              >
                {t('ledger.statementPage.yearly')}
              </Anchor>
            )}
            <Anchor component={Link} to={LEDGER_PATH} size="sm">
              {t('ledger.allTransactions')}
            </Anchor>
          </Group>
        </Group>

        {isLoading ? (
          <Text c="dimmed" className="py-8 text-center">
            {t('common.loading')}
          </Text>
        ) : entries.length === 0 ? (
          <Text c="dimmed" className="py-8 text-center">
            {t('ledger.noEntries')}
          </Text>
        ) : (
          <Card withBorder padding={0}>
            {entries.map((entry, index) => {
              const value = Number(entry.amount);
              return (
                <Fragment key={entry.id}>
                  {index > 0 && <Divider />}
                  <UnstyledButton
                    className="block w-full px-4 py-3"
                    onClick={() => navigate(ledgerTransactionPath(entry.transaction))}
                  >
                    <Group justify="space-between" wrap="nowrap">
                      <div className="min-w-0">
                        <Text size="sm" fw={500} truncate>
                          {entry.description}
                        </Text>
                        <Text size="xs" c="dimmed">
                          #{entry.seq} · {formatDate(entry.occurred_on, language)}
                        </Text>
                      </div>
                      <div className="shrink-0 text-right">
                        <Text size="sm" fw={600} c={value < 0 ? 'red' : 'green'}>
                          {formatMoney(value, account?.currency ?? 'EUR', language, {
                            signed: true,
                          })}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {t('ledger.balanceAfter', {
                            amount: formatMoney(
                              entry.balance_after,
                              account?.currency ?? 'EUR',
                              language,
                            ),
                          })}
                        </Text>
                      </div>
                    </Group>
                  </UnstyledButton>
                </Fragment>
              );
            })}
          </Card>
        )}
        {hasNextPage && (
          <Button
            variant="default"
            onClick={() => void fetchNextPage()}
            loading={isFetchingNextPage}
          >
            {t('ledger.loadMore')}
          </Button>
        )}
      </Stack>

      {isMe && me && (
        <NewLedgerTransactionModal opened={modalOpened} onClose={closeModal} me={me} />
      )}
    </main>
  );
};

export default LedgerAccount;
