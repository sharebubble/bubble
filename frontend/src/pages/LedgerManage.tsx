import { BackButton } from '@/components/layout/BackButton';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  useAllLedgerCategories,
  useAllLedgerProjects,
  useMyLedgerAccount,
  useSaveLedgerCategory,
  useSaveLedgerProject,
} from '@/hooks/useLedger';
import { formatMoney } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import { categoryLabel, type FieldErrors, fieldErrors } from '@/lib/ledger';
import { LEDGER_STATS_PATH } from '@/lib/routes';
import type { LedgerCategory, LedgerProject } from '@/services/django';
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
import { Pencil, Plus } from 'lucide-react';
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

/**
 * The treasurer's settings: income and expense categories (add, rename,
 * retire) and projects with budgets (add, edit, archive). Nothing is deleted,
 * so past transactions keep their category and project.
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
                  <Table.Th className="text-right">{t('ledger.stats.budget')}</Table.Th>
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
      </Stack>

      <CategoryModal draft={categoryDraft} onClose={() => setCategoryDraft(null)} />
      <ProjectModal project={projectDraft} onClose={() => setProjectDraft(null)} />
    </main>
  );
};

export default LedgerManage;
