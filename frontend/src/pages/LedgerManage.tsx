import { BackButton } from '@/components/layout/BackButton';
import { HashValue } from '@/components/ledger/HashValue';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  type LedgerPeriod as ExportPeriod,
  useAllLedgerCategories,
  useAllLedgerProjects,
  useCloseLedgerPeriod,
  useDownloadLedgerExport,
  useLedgerPeriods,
  useLedgerSystemAccounts,
  useMyLedgerAccount,
  useSaveLedgerCategory,
  useSaveLedgerProject,
  useSetDatevNumber,
} from '@/hooks/useLedger';
import { formatMoney } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import { categoryLabel, type FieldErrors, fieldErrors, firstError, today } from '@/lib/ledger';
import { LEDGER_BANK_PATH, LEDGER_CHAIN_PATH, LEDGER_STATS_PATH } from '@/lib/routes';
import type { LedgerAccount, LedgerCategory, LedgerProject } from '@/services/django';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Download, Landmark, Lock, Pencil, Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

type CategoryDraft = { id?: string; name: string; kind: 'income' | 'expense' };

const CategoryModal = ({
  draft,
  onClose,
}: {
  draft: CategoryDraft | null;
  onClose: () => void;
}) => {
  const { t } = useLanguage();
  return (
    <Modal
      opened={!!draft}
      onClose={onClose}
      title={draft?.id ? t('ledger.manage.renameCategory') : t('ledger.manage.newCategory')}
    >
      {draft && <CategoryForm draft={draft} onClose={onClose} />}
    </Modal>
  );
};

const CategoryForm = ({ draft, onClose }: { draft: CategoryDraft; onClose: () => void }) => {
  const { t } = useLanguage();
  const save = useSaveLedgerCategory();
  const [name, setName] = useState(draft.name);
  const [kind, setKind] = useState(draft.kind);
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = async () => {
    setErrors({});
    try {
      await save.mutateAsync(draft.id ? { id: draft.id, name } : { name, kind });
      onClose();
    } catch (error) {
      const found = fieldErrors(error);
      setErrors(Object.keys(found).length ? found : { non_field_errors: t('ledger.postFailed') });
    }
  };

  return (
    <Stack gap="sm">
      <TextInput
        label={t('ledger.manage.name')}
        value={name}
        onChange={event => setName(event.currentTarget.value)}
        required
        error={errors.name}
        data-autofocus
      />
      {!draft.id && (
        <>
          <SegmentedControl
            value={kind}
            onChange={value => setKind(value as 'income' | 'expense')}
            data={[
              { value: 'expense', label: t('ledger.stats.expense') },
              { value: 'income', label: t('ledger.stats.income') },
            ]}
          />
          <Text size="xs" c="dimmed">
            {t('ledger.manage.newCategoryHelp')}
          </Text>
        </>
      )}
      {errors.non_field_errors && <Alert color="red">{errors.non_field_errors}</Alert>}
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button onClick={() => void submit()} loading={save.isPending} disabled={!name.trim()}>
          {t('ledger.manage.save')}
        </Button>
      </Group>
    </Stack>
  );
};

const ProjectModal = ({
  project,
  onClose,
}: {
  project: LedgerProject | 'new' | null;
  onClose: () => void;
}) => {
  const { t } = useLanguage();
  return (
    <Modal
      opened={!!project}
      onClose={onClose}
      title={project === 'new' ? t('ledger.manage.newProject') : t('ledger.manage.editProject')}
    >
      {project && (
        <ProjectForm project={project === 'new' ? undefined : project} onClose={onClose} />
      )}
    </Modal>
  );
};

const ProjectForm = ({ project, onClose }: { project?: LedgerProject; onClose: () => void }) => {
  const { t, language } = useLanguage();
  const save = useSaveLedgerProject();
  const [name, setName] = useState(project?.name ?? '');
  const [budget, setBudget] = useState<number | string>(
    project?.budget ? Number(project.budget) : '',
  );
  const [startsOn, setStartsOn] = useState(project?.starts_on ?? '');
  const [endsOn, setEndsOn] = useState(project?.ends_on ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = async () => {
    setErrors({});
    try {
      await save.mutateAsync({
        id: project?.id,
        name,
        budget: budget === '' ? null : Number(budget).toFixed(2),
        starts_on: startsOn || null,
        ends_on: endsOn || null,
      });
      onClose();
    } catch (error) {
      const found = fieldErrors(error);
      setErrors(Object.keys(found).length ? found : { non_field_errors: t('ledger.postFailed') });
    }
  };

  return (
    <Stack gap="sm">
      <TextInput
        label={t('ledger.manage.name')}
        placeholder={t('ledger.manage.projectPlaceholder')}
        value={name}
        onChange={event => setName(event.currentTarget.value)}
        required
        error={errors.name}
        data-autofocus
      />
      <NumberInput
        label={t('ledger.stats.budget')}
        description={t('ledger.manage.budgetHelp')}
        value={budget}
        onChange={setBudget}
        min={0}
        decimalScale={2}
        decimalSeparator={language === 'de' ? ',' : '.'}
        leftSection={<Text size="sm">€</Text>}
        error={errors.budget}
      />
      <Group grow align="flex-start">
        <TextInput
          type="date"
          label={t('ledger.manage.startsOn')}
          value={startsOn}
          onChange={event => setStartsOn(event.currentTarget.value)}
          error={errors.starts_on}
        />
        <TextInput
          type="date"
          label={t('ledger.manage.endsOn')}
          value={endsOn}
          onChange={event => setEndsOn(event.currentTarget.value)}
          error={errors.ends_on}
        />
      </Group>
      {errors.non_field_errors && <Alert color="red">{errors.non_field_errors}</Alert>}
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button onClick={() => void submit()} loading={save.isPending} disabled={!name.trim()}>
          {t('ledger.manage.save')}
        </Button>
      </Group>
    </Stack>
  );
};

/** The last full calendar year: the usual period to close and hand over. */
const lastYear = (): ExportPeriod => {
  const year = new Date().getFullYear() - 1;
  return { date_from: `${year}-01-01`, date_to: `${year}-12-31` };
};

const ClosePeriodForm = ({ onClose }: { onClose: () => void }) => {
  const { t } = useLanguage();
  const close = useCloseLedgerPeriod();
  const [period, setPeriod] = useState(lastYear);
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = async () => {
    setErrors({});
    try {
      await close.mutateAsync({ starts_on: period.date_from, ends_on: period.date_to });
      notifications.show({ color: 'green', message: t('ledger.periods.closed') });
      onClose();
    } catch (error) {
      const found = fieldErrors(error);
      setErrors(Object.keys(found).length ? found : { non_field_errors: t('ledger.postFailed') });
    }
  };

  return (
    <Stack gap="sm">
      <Text size="sm">{t('ledger.periods.closeBody')}</Text>
      <Group grow align="flex-start">
        <TextInput
          type="date"
          label={t('ledger.manage.startsOn')}
          value={period.date_from}
          onChange={event => setPeriod({ ...period, date_from: event.currentTarget.value })}
          error={errors.starts_on}
        />
        <TextInput
          type="date"
          label={t('ledger.manage.endsOn')}
          value={period.date_to}
          max={today()}
          onChange={event => setPeriod({ ...period, date_to: event.currentTarget.value })}
          error={errors.ends_on}
        />
      </Group>
      {errors.non_field_errors && <Alert color="red">{errors.non_field_errors}</Alert>}
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          color="orange"
          onClick={() => void submit()}
          loading={close.isPending}
          disabled={!period.date_from || !period.date_to}
        >
          {t('ledger.periods.close')}
        </Button>
      </Group>
    </Stack>
  );
};

/** Closed periods, closing the next one, and the journal and DATEV downloads. */
const PeriodsAndExports = () => {
  const { t, language } = useLanguage();
  const { data: periods } = useLedgerPeriods();
  const download = useDownloadLedgerExport();
  const [closing, setClosing] = useState(false);
  const [period, setPeriod] = useState(lastYear);
  const [error, setError] = useState<string | null>(null);

  const get = (format: 'journal' | 'datev') => {
    setError(null);
    download.mutate(
      { format, period },
      { onError: err => setError(firstError(err, t('ledger.downloadFailed'))) },
    );
  };

  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" mb="xs">
        <Title order={2} size="h5">
          {t('ledger.periods.title')}
        </Title>
        <Button
          size="xs"
          variant="default"
          leftSection={<Lock size={14} aria-hidden="true" />}
          onClick={() => setClosing(true)}
        >
          {t('ledger.periods.close')}
        </Button>
      </Group>
      <Text size="sm" c="dimmed" mb="xs">
        {t('ledger.periods.help')}
      </Text>
      {periods?.length ? (
        <Table.ScrollContainer minWidth={480}>
          <Table fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('ledger.periods.period')}</Table.Th>
                <Table.Th>{t('ledger.periods.closedBy')}</Table.Th>
                <Table.Th ta="right">{t('ledger.periods.count')}</Table.Th>
                <Table.Th>{t('ledger.periods.exportHash')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {periods.map(item => (
                <Table.Tr key={item.id}>
                  <Table.Td>
                    {formatDate(item.starts_on, language)} – {formatDate(item.ends_on, language)}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{item.closed_by_name}</Text>
                    <Text size="xs" c="dimmed">
                      {item.closed_at ? formatDate(item.closed_at, language) : ''}
                    </Text>
                  </Table.Td>
                  <Table.Td className="text-right tabular-nums">{item.transaction_count}</Table.Td>
                  <Table.Td>
                    <HashValue hash={item.export_hash} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : (
        <Text size="sm" c="dimmed">
          {t('ledger.periods.none')}
        </Text>
      )}

      <Title order={3} size="h6" mt="md" mb="xs">
        {t('ledger.exports.title')}
      </Title>
      <Group align="flex-end" gap="sm">
        <TextInput
          type="date"
          label={t('ledger.manage.startsOn')}
          value={period.date_from}
          onChange={event => setPeriod({ ...period, date_from: event.currentTarget.value })}
        />
        <TextInput
          type="date"
          label={t('ledger.manage.endsOn')}
          value={period.date_to}
          onChange={event => setPeriod({ ...period, date_to: event.currentTarget.value })}
        />
        <Button
          variant="default"
          leftSection={<Download size={14} aria-hidden="true" />}
          loading={download.isPending && download.variables?.format === 'journal'}
          onClick={() => get('journal')}
        >
          {t('ledger.exports.journal')}
        </Button>
        <Button
          variant="default"
          leftSection={<Download size={14} aria-hidden="true" />}
          loading={download.isPending && download.variables?.format === 'datev'}
          onClick={() => get('datev')}
        >
          {t('ledger.exports.datev')}
        </Button>
      </Group>
      <Text size="xs" c="dimmed" mt="xs">
        {t('ledger.exports.help')}
      </Text>
      {error && (
        <Alert color="red" mt="xs">
          {error}
        </Alert>
      )}

      <Modal opened={closing} onClose={() => setClosing(false)} title={t('ledger.periods.close')}>
        {closing && <ClosePeriodForm onClose={() => setClosing(false)} />}
      </Modal>
    </Card>
  );
};

const DatevNumberInput = ({ account }: { account: LedgerAccount }) => {
  const { t } = useLanguage();
  const save = useSetDatevNumber();
  const [value, setValue] = useState(account.datev_number);
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    if (value === account.datev_number) return;
    setError(null);
    save.mutate(
      { id: account.id, datev_number: value.trim() },
      { onError: err => setError(firstError(err, t('ledger.postFailed'))) },
    );
  };

  return (
    <TextInput
      size="xs"
      inputMode="numeric"
      maxLength={9}
      className="w-28"
      aria-label={t('ledger.datev.number')}
      value={value}
      onChange={event => setValue(event.currentTarget.value.replace(/\D/g, ''))}
      onBlur={commit}
      onKeyDown={event => event.key === 'Enter' && commit()}
      error={error}
    />
  );
};

/** Which account in the tax advisor's chart (SKR 03/04/49) each ledger account is. */
const DatevNumbers = () => {
  const { t } = useLanguage();
  const { data: accounts } = useLedgerSystemAccounts(true);
  return (
    <Card withBorder padding="sm">
      <Title order={2} size="h5" mb="xs">
        {t('ledger.datev.title')}
      </Title>
      <Text size="sm" c="dimmed" mb="xs">
        {t('ledger.datev.help')}
      </Text>
      <Table fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('ledger.account')}</Table.Th>
            <Table.Th>{t('ledger.datev.number')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(accounts ?? []).map(account => (
            <Table.Tr key={account.id}>
              <Table.Td>
                <Text size="sm">{account.name}</Text>
                <Text size="xs" c="dimmed">
                  {t(`ledger.accountType.${account.type}`)} · {account.code}
                </Text>
              </Table.Td>
              <Table.Td>
                <DatevNumberInput account={account} />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  );
};

/**
 * The treasurer's settings: income and expense categories (add, rename,
 * retire), projects with budgets (add, edit, archive), closing periods,
 * exports and DATEV account numbers. Nothing is deleted, so past
 * transactions keep their category and project.
 */
const LedgerManage = () => {
  const { t, language } = useLanguage();
  const { data: me, isLoading: meLoading } = useMyLedgerAccount();
  const isAdmin = !!me?.is_ledger_admin;
  const { data: categories } = useAllLedgerCategories(isAdmin);
  const { data: projects } = useAllLedgerProjects(isAdmin);
  const saveCategory = useSaveLedgerCategory();
  const saveProject = useSaveLedgerProject();
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null);
  const [projectDraft, setProjectDraft] = useState<LedgerProject | 'new' | null>(null);

  const failed = () => notifications.show({ color: 'red', message: t('ledger.postFailed') });
  const editable = (category: LedgerCategory) => category.kind !== 'transfer';

  if (!meLoading && !isAdmin) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-4">
        <Alert color="gray">{t('ledger.manage.treasurerOnly')}</Alert>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-3xl px-4 py-4">
      <Stack gap="md">
        <Group gap="sm">
          <BackButton />
          <Title order={1} size="h3">
            {t('ledger.manage.title')}
          </Title>
        </Group>
        <Text size="sm" c="dimmed">
          {t('ledger.manage.help')}{' '}
          <Anchor component={Link} to={LEDGER_STATS_PATH}>
            {t('ledger.stats.title')}
          </Anchor>
        </Text>
        <Group gap="xs">
          <Button
            component={Link}
            to={LEDGER_BANK_PATH}
            variant="default"
            size="xs"
            leftSection={<Landmark size={14} aria-hidden="true" />}
          >
            {t('ledger.bank.title')}
          </Button>
          <Button
            component={Link}
            to={LEDGER_CHAIN_PATH}
            variant="default"
            size="xs"
            leftSection={<ShieldCheck size={14} aria-hidden="true" />}
          >
            {t('ledger.chain.title')}
          </Button>
        </Group>

        <Card withBorder padding="sm">
          <Group justify="space-between" mb="xs">
            <Title order={2} size="h5">
              {t('ledger.manage.categories')}
            </Title>
            <Button
              size="xs"
              leftSection={<Plus size={14} aria-hidden="true" />}
              onClick={() => setCategoryDraft({ name: '', kind: 'expense' })}
            >
              {t('ledger.manage.add')}
            </Button>
          </Group>
          <Table fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('ledger.manage.name')}</Table.Th>
                <Table.Th>{t('ledger.manage.kind')}</Table.Th>
                <Table.Th>{t('ledger.manage.inUse')}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(categories ?? []).map(category => (
                <Table.Tr key={category.id}>
                  <Table.Td>
                    <Text size="sm" c={category.is_active ? undefined : 'dimmed'}>
                      {categoryLabel(category, t)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="default" size="sm">
                      {t(`ledger.manage.kinds.${category.kind}`)}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    {editable(category) ? (
                      <Switch
                        size="xs"
                        aria-label={t('ledger.manage.inUse')}
                        checked={category.is_active}
                        onChange={event =>
                          saveCategory.mutate(
                            { id: category.id, is_active: event.currentTarget.checked },
                            { onError: failed },
                          )
                        }
                      />
                    ) : (
                      <Text size="xs" c="dimmed">
                        {t('ledger.manage.system')}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td className="text-right">
                    {editable(category) && (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        aria-label={t('ledger.manage.renameCategory')}
                        onClick={() =>
                          setCategoryDraft({
                            id: category.id,
                            name: categoryLabel(category, t),
                            kind: category.kind as 'income' | 'expense',
                          })
                        }
                      >
                        <Pencil size={14} />
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>

        <Card withBorder padding="sm">
          <Group justify="space-between" mb="xs">
            <Title order={2} size="h5">
              {t('ledger.manage.projects')}
            </Title>
            <Button
              size="xs"
              leftSection={<Plus size={14} aria-hidden="true" />}
              onClick={() => setProjectDraft('new')}
            >
              {t('ledger.manage.add')}
            </Button>
          </Group>
          {(projects ?? []).length === 0 ? (
            <Text size="sm" c="dimmed">
              {t('ledger.manage.noProjects')}
            </Text>
          ) : (
            <Table fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('ledger.manage.name')}</Table.Th>
                  <Table.Th ta="right">{t('ledger.stats.budget')}</Table.Th>
                  <Table.Th>{t('ledger.manage.runs')}</Table.Th>
                  <Table.Th>{t('ledger.manage.open')}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(projects ?? []).map(project => (
                  <Table.Tr key={project.id}>
                    <Table.Td>
                      <Text size="sm" c={project.is_archived ? 'dimmed' : undefined}>
                        {project.name}
                      </Text>
                    </Table.Td>
                    <Table.Td className="text-right tabular-nums">
                      {project.budget ? formatMoney(project.budget, 'EUR', language) : '—'}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {project.starts_on ? formatDate(project.starts_on, language) : '…'} –{' '}
                        {project.ends_on ? formatDate(project.ends_on, language) : '…'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Switch
                        size="xs"
                        aria-label={t('ledger.manage.open')}
                        checked={!project.is_archived}
                        onChange={event =>
                          saveProject.mutate(
                            { id: project.id, is_archived: !event.currentTarget.checked },
                            { onError: failed },
                          )
                        }
                      />
                    </Table.Td>
                    <Table.Td className="text-right">
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        aria-label={t('ledger.manage.editProject')}
                        onClick={() => setProjectDraft(project)}
                      >
                        <Pencil size={14} />
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Card>

        <PeriodsAndExports />
        <DatevNumbers />
      </Stack>

      <CategoryModal draft={categoryDraft} onClose={() => setCategoryDraft(null)} />
      <ProjectModal project={projectDraft} onClose={() => setProjectDraft(null)} />
    </main>
  );
};

export default LedgerManage;
