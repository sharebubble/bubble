import { BackButton } from '@/components/layout/BackButton';
import { TextPromptModal } from '@/components/ledger/TextPromptModal';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  type BankLineFilters,
  useBankImports,
  useBankLineCandidates,
  useBankLines,
  useBankSummary,
  useDecideBankLine,
  useLedgerCategories,
  useLedgerMembers,
  useMyLedgerAccount,
  useUploadBankStatement,
} from '@/hooks/useLedger';
import { formatMoney } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import { categoryLabel, firstError } from '@/lib/ledger';
import { ledgerTransactionPath } from '@/lib/routes';
import type {
  LedgerBankLine,
  LedgerMatchConfidenceEnum,
  LedgerTransactionRef,
} from '@/services/django';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  FileButton,
  Group,
  Menu,
  Modal,
  Radio,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { ChevronDown, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

const CONFIDENCE_COLORS: Record<LedgerMatchConfidenceEnum, string> = {
  high: 'green',
  medium: 'blue',
  low: 'yellow',
  none: 'gray',
};

const VIEWS: Record<string, BankLineFilters['state']> = {
  open: ['open'],
  suspense: ['suspense'],
  done: ['booked', 'linked', 'ignored'],
};

type Dialog = { kind: 'book' | 'assign' | 'link' | 'park' | 'ignore'; line: LedgerBankLine } | null;

const TransactionLink = ({ transaction }: { transaction: LedgerTransactionRef }) => (
  <Anchor component={Link} to={ledgerTransactionPath(transaction.id)}>
    #{transaction.seq}
  </Anchor>
);

/** Book to a member (top-up or payout) or to an income or expense category. */
const BookForm = ({
  line,
  assign,
  onClose,
}: {
  line: LedgerBankLine;
  assign: boolean;
  onClose: () => void;
}) => {
  const { t } = useLanguage();
  const incoming = Number(line.amount) > 0;
  const decide = useDecideBankLine();
  const { data: members } = useLedgerMembers(true);
  const { data: categories } = useLedgerCategories(incoming ? 'income' : 'expense');
  // Money going out without a known member is most often a community expense.
  const [target, setTarget] = useState<'member' | 'category'>(
    line.proposed_account || incoming ? 'member' : 'category',
  );
  const [account, setAccount] = useState<string | null>(line.proposed_account?.id ?? null);
  const [category, setCategory] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      await decide.mutateAsync({
        action: assign ? 'assign' : 'book',
        id: line.id,
        body: target === 'member' ? { account, description } : { category, description },
      });
      onClose();
    } catch (err) {
      setError(firstError(err, t('ledger.postFailed')));
    }
  };

  return (
    <Stack gap="sm">
      <SegmentedControl
        value={target}
        onChange={value => setTarget(value as 'member' | 'category')}
        data={[
          {
            value: 'member',
            label: incoming ? t('ledger.bank.asTopUp') : t('ledger.bank.asPayout'),
          },
          {
            value: 'category',
            label: incoming ? t('ledger.bank.asIncome') : t('ledger.bank.asExpense'),
          },
        ]}
      />
      {target === 'member' ? (
        <Select
          label={t('ledger.bank.member')}
          data={(members ?? []).map(member => ({ value: member.id, label: member.name }))}
          value={account}
          onChange={setAccount}
          searchable
          required
          data-autofocus
        />
      ) : (
        <Select
          label={t('ledger.category')}
          data={(categories ?? []).map(item => ({
            value: item.id,
            label: categoryLabel(item, t),
          }))}
          value={category}
          onChange={setCategory}
          searchable
          required
        />
      )}
      <TextInput
        label={t('ledger.description')}
        placeholder={line.reference || line.counterparty_name}
        description={t('ledger.bank.descriptionHelp')}
        value={description}
        onChange={event => setDescription(event.currentTarget.value)}
      />
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          onClick={() => void submit()}
          loading={decide.isPending}
          disabled={target === 'member' ? !account : !category}
        >
          {t('ledger.bank.book')}
        </Button>
      </Group>
    </Stack>
  );
};

/** Pick the entry someone already posted by hand for this money. */
const LinkForm = ({ line, onClose }: { line: LedgerBankLine; onClose: () => void }) => {
  const { t, language } = useLanguage();
  const decide = useDecideBankLine();
  const { data: candidates, isLoading } = useBankLineCandidates(line.id);
  const [choice, setChoice] = useState<string | null>(line.proposed_transaction?.id ?? null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!choice) return;
    setError(null);
    try {
      await decide.mutateAsync({ action: 'link', id: line.id, transaction: choice });
      onClose();
    } catch (err) {
      setError(firstError(err, t('ledger.postFailed')));
    }
  };

  if (isLoading) return <Text c="dimmed">{t('common.loading')}</Text>;

  return (
    <Stack gap="sm">
      <Text size="sm">{t('ledger.bank.linkHelp')}</Text>
      {candidates?.length ? (
        <Radio.Group value={choice} onChange={setChoice}>
          <Stack gap="xs">
            {candidates.map(candidate => (
              <Radio
                key={candidate.id}
                value={candidate.id}
                label={`#${candidate.seq} · ${formatDate(candidate.occurred_on, language)} · ${candidate.description}`}
              />
            ))}
          </Stack>
        </Radio.Group>
      ) : (
        <Text size="sm" c="dimmed">
          {t('ledger.bank.noCandidates')}
        </Text>
      )}
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button onClick={() => void submit()} loading={decide.isPending} disabled={!choice}>
          {t('ledger.bank.link')}
        </Button>
      </Group>
    </Stack>
  );
};

const LineOutcome = ({ line }: { line: LedgerBankLine }) => {
  const { t } = useLanguage();
  const decide = useDecideBankLine();
  return (
    <Group gap="xs" justify="space-between">
      <Text size="sm">
        {line.state === 'booked' && (line.settlement ?? line.transaction) && (
          <>
            {t('ledger.bank.bookedAs')}{' '}
            <TransactionLink transaction={(line.settlement ?? line.transaction)!} />
          </>
        )}
        {line.state === 'linked' && line.transaction && (
          <>
            {t('ledger.bank.linkedTo')} <TransactionLink transaction={line.transaction} />
          </>
        )}
        {line.state === 'suspense' && line.transaction && (
          <>
            {t('ledger.bank.parkedAs')} <TransactionLink transaction={line.transaction} />
          </>
        )}
        {line.state === 'ignored' && `${t('ledger.bank.ignoredBecause')} ${line.note}`}
        {line.resolved_by_name && (
          <Text span size="xs" c="dimmed">
            {' '}
            · {line.resolved_by_name}
          </Text>
        )}
      </Text>
      {(line.state === 'linked' || line.state === 'ignored') && (
        <Button
          size="compact-xs"
          variant="subtle"
          loading={decide.isPending}
          onClick={() =>
            decide.mutate(
              { action: 'reopen', id: line.id },
              {
                onError: err =>
                  notifications.show({
                    color: 'red',
                    message: firstError(err, t('ledger.postFailed')),
                  }),
              },
            )
          }
        >
          {t('ledger.bank.reopen')}
        </Button>
      )}
    </Group>
  );
};

const LineCard = ({
  line,
  onDialog,
}: {
  line: LedgerBankLine;
  onDialog: (dialog: Dialog) => void;
}) => {
  const { t, language } = useLanguage();
  const decide = useDecideBankLine();
  const amount = Number(line.amount);
  const failed = (err: unknown) =>
    notifications.show({ color: 'red', message: firstError(err, t('ledger.postFailed')) });

  const quick = line.proposed_transaction
    ? {
        label: t('ledger.bank.linkTo', { seq: line.proposed_transaction.seq }),
        run: () =>
          decide.mutate(
            { action: 'link', id: line.id, transaction: line.proposed_transaction!.id },
            { onError: failed },
          ),
      }
    : line.proposed_account
      ? {
          label: t('ledger.bank.bookTo', { name: line.proposed_account.name }),
          run: () =>
            decide.mutate(
              { action: 'book', id: line.id, body: { account: line.proposed_account!.id } },
              { onError: failed },
            ),
        }
      : null;

  return (
    <Card withBorder padding="sm">
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <div className="min-w-0">
            <Text size="sm" fw={500} truncate>
              {line.counterparty_name || t('ledger.bank.unknownParty')}
            </Text>
            <Text size="xs" c="dimmed">
              {formatDate(line.booked_on, language)}
              {line.counterparty_iban && ` · ${line.counterparty_iban}`}
            </Text>
          </div>
          <Text fw={700} c={amount < 0 ? 'red' : 'green'} className="shrink-0 tabular-nums">
            {formatMoney(amount, line.currency, language, { signed: true })}
          </Text>
        </Group>
        {line.reference && (
          <Text size="sm" lineClamp={2} className="break-words">
            {line.reference}
          </Text>
        )}

        {line.state === 'open' ? (
          <>
            {line.confidence !== 'none' && (
              <Group gap="xs">
                <Badge color={CONFIDENCE_COLORS[line.confidence]} variant="light" size="sm">
                  {t(`ledger.bank.confidence.${line.confidence}`)}
                </Badge>
                <Text size="xs" c="dimmed">
                  {line.proposed_account?.name}
                  {line.reason && ` · ${line.reason}`}
                </Text>
              </Group>
            )}
            <Group gap="xs">
              {quick && (
                <Button size="xs" onClick={quick.run} loading={decide.isPending}>
                  {quick.label}
                </Button>
              )}
              <Menu position="bottom-start">
                <Menu.Target>
                  <Button
                    size="xs"
                    variant={quick ? 'default' : 'filled'}
                    rightSection={<ChevronDown size={14} aria-hidden="true" />}
                  >
                    {quick ? t('ledger.bank.other') : t('ledger.bank.decide')}
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item onClick={() => onDialog({ kind: 'book', line })}>
                    {t('ledger.bank.bookEllipsis')}
                  </Menu.Item>
                  <Menu.Item onClick={() => onDialog({ kind: 'link', line })}>
                    {t('ledger.bank.linkEllipsis')}
                  </Menu.Item>
                  <Menu.Item onClick={() => onDialog({ kind: 'park', line })}>
                    {t('ledger.bank.parkEllipsis')}
                  </Menu.Item>
                  <Menu.Item onClick={() => onDialog({ kind: 'ignore', line })}>
                    {t('ledger.bank.ignoreEllipsis')}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
          </>
        ) : (
          <>
            <LineOutcome line={line} />
            {line.state === 'suspense' && (
              <Group gap="xs">
                {line.note && (
                  <Text size="xs" c="dimmed">
                    {line.note}
                  </Text>
                )}
                <Button size="xs" onClick={() => onDialog({ kind: 'assign', line })}>
                  {t('ledger.bank.assign')}
                </Button>
              </Group>
            )}
          </>
        )}
      </Stack>
    </Card>
  );
};

const Lines = ({ view, onDialog }: { view: string; onDialog: (dialog: Dialog) => void }) => {
  const { t } = useLanguage();
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useBankLines({
    state: VIEWS[view],
  });
  const lines = data?.pages.flatMap(page => page.results) ?? [];

  if (isLoading) {
    return (
      <Text c="dimmed" className="py-8 text-center">
        {t('common.loading')}
      </Text>
    );
  }
  if (!lines.length) {
    return (
      <Text c="dimmed" className="py-8 text-center">
        {t(`ledger.bank.empty.${view}`)}
      </Text>
    );
  }
  return (
    <Stack gap="xs">
      {lines.map(line => (
        <LineCard key={line.id} line={line} onDialog={onDialog} />
      ))}
      {hasNextPage && (
        <Button variant="default" onClick={() => void fetchNextPage()} loading={isFetchingNextPage}>
          {t('ledger.loadMore')}
        </Button>
      )}
    </Stack>
  );
};

/**
 * The treasurer's bank reconciliation (plan section 12): upload the statement
 * from online banking (CAMT.053 or CSV), then book, link, park or ignore each
 * line. Which bank interface to connect directly is still open (D11).
 */
const LedgerBank = () => {
  const { t, language } = useLanguage();
  const { data: me, isLoading: meLoading } = useMyLedgerAccount();
  const isAdmin = !!me?.is_ledger_admin;
  const { data: summary } = useBankSummary();
  const { data: imports } = useBankImports();
  const upload = useUploadBankStatement();
  const decide = useDecideBankLine();
  const [view, setView] = useState('open');
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);

  if (!meLoading && !isAdmin) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-4">
        <Alert color="gray">{t('ledger.bank.treasurerOnly')}</Alert>
      </main>
    );
  }

  const onFile = (file: File | null) => {
    if (!file) return;
    upload.mutate(file, {
      onSuccess: result =>
        notifications.show({
          color: 'green',
          message: t('ledger.bank.imported', {
            count: result.statement.new_line_count,
            duplicates: result.duplicates,
            booked: result.booked,
          }),
        }),
      onError: err =>
        notifications.show({
          color: 'red',
          message: firstError(err, t('ledger.bank.importFailed')),
        }),
    });
  };

  const money = (value: string | number) => formatMoney(value, me?.currency ?? 'EUR', language);

  return (
    <main className="container mx-auto max-w-3xl px-4 py-4">
      <Stack gap="md">
        <Group justify="space-between">
          <Group gap="sm">
            <BackButton />
            <Title order={1} size="h3">
              {t('ledger.bank.title')}
            </Title>
          </Group>
          <FileButton onChange={onFile} accept=".xml,.csv,.txt,text/csv,application/xml,text/xml">
            {props => (
              <Button
                {...props}
                loading={upload.isPending}
                leftSection={<Upload size={16} aria-hidden="true" />}
              >
                {t('ledger.bank.upload')}
              </Button>
            )}
          </FileButton>
        </Group>
        <Text size="sm" c="dimmed">
          {t('ledger.bank.help')}
        </Text>

        {summary && (
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
            <Card withBorder padding="xs">
              <Text size="xs" c="dimmed">
                {t('ledger.bank.toReview')}
              </Text>
              <Text fw={700}>{summary.open}</Text>
            </Card>
            <Card withBorder padding="xs">
              <Text size="xs" c="dimmed">
                {t('ledger.bank.parked')}
              </Text>
              <Text fw={700}>
                {summary.suspense} · {money(Math.abs(Number(summary.suspense_balance)))}
              </Text>
            </Card>
            <Card withBorder padding="xs">
              <Text size="xs" c="dimmed">
                {t('ledger.bank.balanceInBooks')}
              </Text>
              <Text fw={700}>{money(summary.bank_balance)}</Text>
            </Card>
            <Card withBorder padding="xs">
              <Text size="xs" c="dimmed">
                {t('ledger.bank.newestLine')}
              </Text>
              <Text fw={700}>
                {summary.last_booked_on ? formatDate(summary.last_booked_on, language) : '—'}
              </Text>
            </Card>
          </SimpleGrid>
        )}
        {summary && (
          <Text size="xs" c="dimmed">
            {summary.auto_confirm ? t('ledger.bank.autoOn') : t('ledger.bank.autoOff')}{' '}
            {t('ledger.bank.compareBalance')}
          </Text>
        )}

        <Tabs value={view} onChange={value => setView(value ?? 'open')} keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="open">
              {t('ledger.bank.tabs.open')}
              {summary?.open ? ` (${summary.open})` : ''}
            </Tabs.Tab>
            <Tabs.Tab value="suspense">
              {t('ledger.bank.tabs.suspense')}
              {summary?.suspense ? ` (${summary.suspense})` : ''}
            </Tabs.Tab>
            <Tabs.Tab value="done">{t('ledger.bank.tabs.done')}</Tabs.Tab>
          </Tabs.List>
          {Object.keys(VIEWS).map(key => (
            <Tabs.Panel key={key} value={key} pt="md">
              <Lines view={key} onDialog={setDialog} />
            </Tabs.Panel>
          ))}
        </Tabs>

        {!!imports?.results.length && (
          <Card withBorder padding="sm">
            <Title order={2} size="h5" mb="xs">
              {t('ledger.bank.files')}
            </Title>
            <Table.ScrollContainer minWidth={420}>
              <Table fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('ledger.date')}</Table.Th>
                    <Table.Th>{t('ledger.bank.file')}</Table.Th>
                    <Table.Th ta="right">{t('ledger.bank.newLines')}</Table.Th>
                    <Table.Th ta="right">{t('ledger.bank.stillOpen')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {imports.results.map(item => (
                    <Table.Tr key={item.id}>
                      <Table.Td>{formatDate(item.imported_at, language)}</Table.Td>
                      <Table.Td>
                        <Text size="sm" truncate>
                          {item.file_name || item.source}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {item.imported_by_name}
                        </Text>
                      </Table.Td>
                      <Table.Td className="text-right tabular-nums">
                        {item.new_line_count} / {item.line_count}
                      </Table.Td>
                      <Table.Td className="text-right tabular-nums">{item.open_count}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
        )}
      </Stack>

      <Modal
        opened={dialog?.kind === 'book' || dialog?.kind === 'assign'}
        onClose={close}
        title={
          dialog?.kind === 'assign' ? t('ledger.bank.assignTitle') : t('ledger.bank.bookTitle')
        }
      >
        {dialog && (dialog.kind === 'book' || dialog.kind === 'assign') && (
          <BookForm line={dialog.line} assign={dialog.kind === 'assign'} onClose={close} />
        )}
      </Modal>
      <Modal opened={dialog?.kind === 'link'} onClose={close} title={t('ledger.bank.linkTitle')}>
        {dialog?.kind === 'link' && <LinkForm line={dialog.line} onClose={close} />}
      </Modal>
      <TextPromptModal
        opened={dialog?.kind === 'park'}
        onClose={close}
        title={t('ledger.bank.parkTitle')}
        body={t('ledger.bank.parkBody')}
        label={t('ledger.bank.note')}
        confirm={t('ledger.bank.park')}
        optional
        loading={decide.isPending}
        onSubmit={note => decide.mutateAsync({ action: 'park', id: dialog!.line.id, note })}
        errorMessage={err => firstError(err, t('ledger.postFailed'))}
      />
      <TextPromptModal
        opened={dialog?.kind === 'ignore'}
        onClose={close}
        title={t('ledger.bank.ignoreTitle')}
        body={t('ledger.bank.ignoreBody')}
        label={t('ledger.bank.reason')}
        confirm={t('ledger.bank.ignore')}
        color="gray"
        loading={decide.isPending}
        onSubmit={note => decide.mutateAsync({ action: 'ignore', id: dialog!.line.id, note })}
        errorMessage={err => firstError(err, t('ledger.postFailed'))}
      />
    </main>
  );
};

export default LedgerBank;
