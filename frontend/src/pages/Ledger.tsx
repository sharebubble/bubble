import { BackButton } from '@/components/layout/BackButton';
import { CostShareList } from '@/components/ledger/CostShareList';
import { CostShareModal } from '@/components/ledger/CostShareModal';
import { LedgerBalanceCard } from '@/components/ledger/LedgerBalanceCard';
import { LedgerTransactionRow } from '@/components/ledger/LedgerTransactionRow';
import { NewLedgerTransactionModal } from '@/components/ledger/NewLedgerTransactionModal';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  type LedgerTransactionFilters,
  useLedgerBalances,
  useLedgerCategories,
  useLedgerCostShares,
  useLedgerHealth,
  useLedgerProjects,
  useLedgerTransactions,
  useLedgerUnbilled,
  useMyLedgerAccount,
} from '@/hooks/useLedger';
import { formatMoney } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import { categoryLabel } from '@/lib/ledger';
import {
  LEDGER_BANK_PATH,
  LEDGER_CHAIN_PATH,
  LEDGER_MANAGE_PATH,
  LEDGER_REPORT_PATH,
  LEDGER_STATS_PATH,
  MY_LEDGER_PATH,
  MY_STATEMENT_PATH,
  ledgerAccountPath,
} from '@/lib/routes';
import type { LedgerMyAccount, LedgerTransactionKindEnum } from '@/services/django';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Menu,
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
import {
  AlertTriangle,
  BarChart3,
  FileText,
  Landmark,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Split,
  X,
} from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

const KINDS: LedgerTransactionKindEnum[] = [
  'member_expense',
  'top_up',
  'member_transfer',
  'booking_charge',
  'shared_expense',
  'payout',
  'income',
  'expense',
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
  const onlyDisputed = params.get('disputed') === '1';
  // Set by drilling down from the statistics page.
  const categoryId = params.get('category');
  const projectId = params.get('project');
  const { data: categories } = useLedgerCategories();
  const { data: projects } = useLedgerProjects();
  const drillDown = categoryId
    ? (() => {
        const category = categories?.find(c => c.id === categoryId);
        return { key: 'category', label: category ? categoryLabel(category, t) : '…' };
      })()
    : projectId
      ? { key: 'project', label: projects?.find(p => p.id === projectId)?.name ?? '…' }
      : null;

  const filters = useMemo<LedgerTransactionFilters>(
    () => ({
      q: debouncedSearch || undefined,
      kind: kind ? [kind] : undefined,
      member: onlyMine && ownerId ? ownerId : undefined,
      disputed: onlyDisputed || undefined,
      category: categoryId ?? undefined,
      project: projectId ?? undefined,
    }),
    [debouncedSearch, kind, onlyMine, ownerId, onlyDisputed, categoryId, projectId],
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
        <Switch
          label={t('ledger.onlyDisputed')}
          checked={onlyDisputed}
          onChange={event => setParam('disputed', event.currentTarget.checked ? '1' : null)}
          className="pb-2"
        />
      </Group>
      {drillDown && (
        <Group gap="xs">
          <Badge
            variant="light"
            size="lg"
            rightSection={
              <ActionIcon
                size="xs"
                variant="transparent"
                aria-label={t('ledger.clearFilter')}
                onClick={() => setParam(drillDown.key, null)}
              >
                <X size={12} />
              </ActionIcon>
            }
          >
            {t(`ledger.filteredBy.${drillDown.key}`, { name: drillDown.label })}
          </Badge>
        </Group>
      )}

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

/** Shared expenses: open ones first, then recently booked or withdrawn. */
const CostShares = ({ me }: { me?: LedgerMyAccount }) => {
  const { t } = useLanguage();
  const { data: open, isLoading } = useLedgerCostShares({ state: 'open' });
  const { data: all } = useLedgerCostShares();
  const closed = (all?.results ?? []).filter(costShare => costShare.state !== 'open');

  if (isLoading) {
    return (
      <Text c="dimmed" className="py-8 text-center">
        {t('common.loading')}
      </Text>
    );
  }

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {t('ledger.split.listHelp')}
      </Text>
      <Title order={2} size="h5">
        {t('ledger.split.openTitle')}
      </Title>
      {open?.results.length ? (
        <CostShareList costShares={open.results} me={me} />
      ) : (
        <Text size="sm" c="dimmed">
          {t('ledger.split.noneOpen')}
        </Text>
      )}
      {closed.length > 0 && (
        <>
          <Title order={2} size="h5">
            {t('ledger.split.closedTitle')}
          </Title>
          <CostShareList costShares={closed} me={me} />
        </>
      )}
    </Stack>
  );
};

/** Bookings the ledger could not charge, with the reason (treasurer only). */
const UnbilledBookings = () => {
  const { t, language } = useLanguage();
  const { data, isLoading } = useLedgerUnbilled(true);

  if (isLoading) {
    return (
      <Text c="dimmed" className="py-8 text-center">
        {t('common.loading')}
      </Text>
    );
  }
  if (!data?.length) {
    return (
      <Text c="dimmed" className="py-8 text-center">
        {t('ledger.unbilledEmpty')}
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">
        {t('ledger.unbilledHelp')}
      </Text>
      <Card withBorder padding={0}>
        {data.map((row, index) => (
          <Fragment key={row.id}>
            {index > 0 && <Divider />}
            <Group justify="space-between" wrap="nowrap" className="px-4 py-3">
              <div className="min-w-0">
                <Text size="sm" fw={500} truncate>
                  {row.item_name} · {row.booker}
                </Text>
                <Text size="xs" c="dimmed">
                  {formatDate(row.updated_at, language)} · {row.note}
                </Text>
              </div>
              {row.amount && (
                <Text size="sm" fw={600} className="shrink-0">
                  {formatMoney(row.amount, row.currency || 'EUR', language)}
                </Text>
              )}
            </Group>
          </Fragment>
        ))}
      </Card>
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
  const [splitOpened, { open: openSplit, close: closeSplit }] = useDisclosure(false);
  const requested = params.get('view');
  const view =
    requested === 'balances' ||
    requested === 'splits' ||
    (requested === 'unbilled' && me?.is_ledger_admin)
      ? requested
      : 'transactions';

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
            <Group gap="xs">
              <Button
                variant="default"
                leftSection={<Split size={16} aria-hidden="true" />}
                onClick={openSplit}
              >
                {t('ledger.split.button')}
              </Button>
              <Button leftSection={<Plus size={16} aria-hidden="true" />} onClick={openModal}>
                {t('ledger.newTransaction')}
              </Button>
              <Menu position="bottom-end">
                <Menu.Target>
                  <ActionIcon variant="default" size="lg" aria-label={t('ledger.more')}>
                    <MoreHorizontal size={18} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    leftSection={<BarChart3 size={16} />}
                    onClick={() => navigate(LEDGER_STATS_PATH)}
                  >
                    {t('ledger.stats.title')}
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<FileText size={16} />}
                    onClick={() => navigate(LEDGER_REPORT_PATH)}
                  >
                    {t('ledger.report.title')}
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<FileText size={16} />}
                    onClick={() => navigate(MY_STATEMENT_PATH)}
                  >
                    {t('ledger.statementPage.mine')}
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<ShieldCheck size={16} />}
                    onClick={() => navigate(LEDGER_CHAIN_PATH)}
                  >
                    {t('ledger.chain.title')}
                  </Menu.Item>
                  {me.is_ledger_admin && (
                    <>
                      <Menu.Divider />
                      <Menu.Item
                        leftSection={<Landmark size={16} />}
                        onClick={() => navigate(LEDGER_BANK_PATH)}
                      >
                        {t('ledger.bank.title')}
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<Settings size={16} />}
                        onClick={() => navigate(LEDGER_MANAGE_PATH)}
                      >
                        {t('ledger.manage.title')}
                      </Menu.Item>
                    </>
                  )}
                </Menu.Dropdown>
              </Menu>
            </Group>
          )}
        </Group>

        {health && !health.ok && (
          <Alert
            color="red"
            icon={<AlertTriangle size={16} aria-hidden="true" />}
            title={t('ledger.healthTitle')}
          >
            {health.chain_ok === false ? t('ledger.chain.brokenBody') : t('ledger.healthBody')}{' '}
            <Anchor component={Link} to={LEDGER_CHAIN_PATH} size="sm">
              {t('ledger.chain.title')}
            </Anchor>
          </Alert>
        )}

        {me && <LedgerBalanceCard account={me} isMe onClick={() => navigate(MY_LEDGER_PATH)} />}

        <Tabs
          keepMounted={false}
          value={view}
          onChange={value => {
            const next = new URLSearchParams(params);
            if (value && value !== 'transactions') next.set('view', value);
            else next.delete('view');
            setParams(next, { replace: true });
          }}
        >
          <Tabs.List>
            <Tabs.Tab value="transactions">{t('ledger.transactions')}</Tabs.Tab>
            <Tabs.Tab value="balances">{t('ledger.balances')}</Tabs.Tab>
            <Tabs.Tab value="splits">{t('ledger.split.tab')}</Tabs.Tab>
            {me?.is_ledger_admin && <Tabs.Tab value="unbilled">{t('ledger.unbilled')}</Tabs.Tab>}
          </Tabs.List>
          <Tabs.Panel value="transactions" pt="md">
            <TransactionFeed ownerId={me?.owner} />
          </Tabs.Panel>
          <Tabs.Panel value="balances" pt="md">
            <MemberBalances />
          </Tabs.Panel>
          <Tabs.Panel value="splits" pt="md">
            <CostShares me={me} />
          </Tabs.Panel>
          {me?.is_ledger_admin && (
            <Tabs.Panel value="unbilled" pt="md">
              <UnbilledBookings />
            </Tabs.Panel>
          )}
        </Tabs>
      </Stack>

      {me && <NewLedgerTransactionModal opened={modalOpened} onClose={closeModal} me={me} />}
      {me && <CostShareModal opened={splitOpened} onClose={closeSplit} me={me} />}
    </main>
  );
};

export default Ledger;
