import { BackButton } from '@/components/layout/BackButton';
import { LedgerBalanceCard } from '@/components/ledger/LedgerBalanceCard';
import { LedgerTransactionRow } from '@/components/ledger/LedgerTransactionRow';
import { NewLedgerTransactionModal } from '@/components/ledger/NewLedgerTransactionModal';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  type LedgerTransactionFilters,
  useLedgerBalances,
  useLedgerHealth,
  useLedgerTransactions,
  useMyLedgerAccount,
} from '@/hooks/useLedger';
import { formatMoney } from '@/lib/currency';
import { MY_LEDGER_PATH, ledgerAccountPath } from '@/lib/routes';
import type { LedgerTransactionKindEnum } from '@/services/django';
import {
  Alert,
  Button,
  Card,
  Divider,
  Group,
  NavLink,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { AlertTriangle, Plus, Search } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

const KINDS: LedgerTransactionKindEnum[] = [
  'member_expense',
  'top_up',
  'member_transfer',
  'booking_charge',
  'shared_expense',
  'payout',
  'income',
  'membership_fee',
  'reversal',
  'correction',
  'adjustment',
  'opening_balance',
];

const TransactionFeed = ({ ownerId }: { ownerId?: string | null }) => {
  const { t } = useLanguage();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const kind = params.get('kind') as LedgerTransactionKindEnum | null;
  const onlyMine = params.get('mine') === '1';

  const filters = useMemo<LedgerTransactionFilters>(
    () => ({
      q: debouncedSearch || undefined,
      kind: kind ? [kind] : undefined,
      member: onlyMine && ownerId ? ownerId : undefined,
    }),
    [debouncedSearch, kind, onlyMine, ownerId],
  );
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useLedgerTransactions(filters);
  const transactions = data?.pages.flatMap(page => page.results) ?? [];

  // Filters live in the URL so a filtered view can be shared as a link.
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <Stack gap="sm">
      <Group gap="sm" align="flex-end">
        <TextInput
          className="min-w-[12rem] flex-1"
          leftSection={<Search size={16} aria-hidden="true" />}
          placeholder={t('ledger.search')}
          aria-label={t('ledger.search')}
          value={search}
          onChange={event => {
            setSearch(event.currentTarget.value);
            setParam('q', event.currentTarget.value);
          }}
        />
        <Select
          className="min-w-[10rem]"
          placeholder={t('ledger.allKinds')}
          aria-label={t('ledger.allKinds')}
          data={KINDS.map(value => ({ value, label: t(`ledger.kind.${value}`) }))}
          value={kind}
          onChange={value => setParam('kind', value)}
          clearable
        />
        <Switch
          label={t('ledger.onlyMine')}
          checked={onlyMine}
          onChange={event => setParam('mine', event.currentTarget.checked ? '1' : null)}
          className="pb-2"
        />
      </Group>

      {isLoading ? (
        <Text c="dimmed" className="py-8 text-center">
          {t('common.loading')}
        </Text>
      ) : isError ? (
        <Text c="red" className="py-8 text-center">
          {t('common.loadingError')}
        </Text>
      ) : transactions.length === 0 ? (
        <Text c="dimmed" className="py-8 text-center">
          {t('ledger.empty')}
        </Text>
      ) : (
        <Stack gap="xs">
          {transactions.map(transaction => (
            <LedgerTransactionRow key={transaction.id} transaction={transaction} />
          ))}
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
      )}
    </Stack>
  );
};

const MemberBalances = () => {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useLedgerBalances();
  const accounts = data?.pages.flatMap(page => page.results) ?? [];

  if (isLoading) {
    return (
      <Text c="dimmed" className="py-8 text-center">
        {t('common.loading')}
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">
        {t('ledger.balancesHelp')}
      </Text>
      <Card withBorder padding={0}>
        {accounts.map((account, index) => {
          const balance = Number(account.balance);
          return (
            <Fragment key={account.id}>
              {index > 0 && <Divider />}
              <NavLink
                label={account.name}
                description={account.is_active ? undefined : t('ledger.formerMember')}
                onClick={() => navigate(ledgerAccountPath(account.id))}
                rightSection={
                  <Text fw={600} c={balance < 0 ? 'red' : balance > 0 ? 'green' : undefined}>
                    {formatMoney(balance, account.currency, language, { signed: true })}
                  </Text>
                }
              />
            </Fragment>
          );
        })}
      </Card>
      {hasNextPage && (
        <Button variant="default" onClick={() => void fetchNextPage()} loading={isFetchingNextPage}>
          {t('ledger.loadMore')}
        </Button>
      )}
    </Stack>
  );
};

/**
 * The community ledger: every transaction and every balance, visible to all
 * members (plan D8). Posting happens through the "new entry" dialog.
 */
const Ledger = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: me } = useMyLedgerAccount();
  const { data: health } = useLedgerHealth();
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
  const view = params.get('view') === 'balances' ? 'balances' : 'transactions';

  return (
    <main className="container mx-auto max-w-3xl px-4 py-4">
      <Stack gap="md">
        <Group justify="space-between">
          <Group gap="sm">
            <BackButton />
            <Title order={1} size="h3">
              {t('ledger.title')}
            </Title>
          </Group>
          {me && (
            <Button leftSection={<Plus size={16} aria-hidden="true" />} onClick={openModal}>
              {t('ledger.newTransaction')}
            </Button>
          )}
        </Group>

        {health && !health.ok && (
          <Alert
            color="red"
            icon={<AlertTriangle size={16} aria-hidden="true" />}
            title={t('ledger.healthTitle')}
          >
            {t('ledger.healthBody')}
          </Alert>
        )}

        {me && <LedgerBalanceCard account={me} isMe onClick={() => navigate(MY_LEDGER_PATH)} />}

        <Tabs
          keepMounted={false}
          value={view}
          onChange={value => {
            const next = new URLSearchParams(params);
            if (value === 'balances') next.set('view', 'balances');
            else next.delete('view');
            setParams(next, { replace: true });
          }}
        >
          <Tabs.List>
            <Tabs.Tab value="transactions">{t('ledger.transactions')}</Tabs.Tab>
            <Tabs.Tab value="balances">{t('ledger.balances')}</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="transactions" pt="md">
            <TransactionFeed ownerId={me?.owner} />
          </Tabs.Panel>
          <Tabs.Panel value="balances" pt="md">
            <MemberBalances />
          </Tabs.Panel>
        </Tabs>
      </Stack>

      {me && <NewLedgerTransactionModal opened={modalOpened} onClose={closeModal} me={me} />}
    </main>
  );
};

export default Ledger;
