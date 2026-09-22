import { useLanguage } from '@/contexts/LanguageContext';
import {
  useLedgerCategories,
  useLedgerMembers,
  useLedgerProjects,
  usePostLedgerTransaction,
} from '@/hooks/useLedger';
import { formatMoney } from '@/lib/currency';
import { categoryLabel } from '@/lib/ledger';
import { ledgerTransactionPath } from '@/lib/routes';
import type { LedgerIntentEnum, LedgerMyAccount, LedgerViaEnum } from '@/services/django';
import {
  Alert,
  Button,
  FileInput,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { Paperclip } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const MEMBER_INTENTS: LedgerIntentEnum[] = ['expense_for_community', 'top_up', 'member_to_member'];
const TREASURER_INTENTS: LedgerIntentEnum[] = ['payout', 'income'];
const NEEDS_CATEGORY: Partial<Record<LedgerIntentEnum, 'expense' | 'income'>> = {
  expense_for_community: 'expense',
  income: 'income',
};
const NEEDS_COUNTERPARTY = new Set<LedgerIntentEnum>(['member_to_member', 'payout']);
const NEEDS_VIA = new Set<LedgerIntentEnum>(['top_up', 'payout', 'income']);
/** How the poster's own balance moves, per unit of amount. */
const MY_EFFECT: Partial<Record<LedgerIntentEnum, number>> = {
  expense_for_community: 1,
  top_up: 1,
  member_to_member: -1,
};
const RECEIPT_TYPES = 'application/pdf,image/jpeg,image/png,image/webp,image/heic';

type FieldErrors = Partial<Record<string, string>>;

const today = () => new Date().toLocaleDateString('en-CA');

/** The API answers a rejected posting with `{field: [message]}`. */
const fieldErrors = (error: unknown): FieldErrors => {
  if (!error || typeof error !== 'object') return {};
  return Object.fromEntries(
    Object.entries(error as Record<string, unknown>).map(([field, messages]) => [
      field,
      Array.isArray(messages) ? String(messages[0]) : String(messages),
    ]),
  );
};

interface NewLedgerTransactionModalProps {
  opened: boolean;
  onClose: () => void;
  me: LedgerMyAccount;
}

/**
 * Post a manual transaction as an intent — "I paid 50 € for the community" —
 * never as raw entries. Members can only ever charge their own account; the
 * treasurer additionally books payouts and community income.
 */
export const NewLedgerTransactionModal = ({
  opened,
  onClose,
  me,
}: NewLedgerTransactionModalProps) => {
  const { t } = useLanguage();
  // The modal unmounts its content when closed, so every opening starts with
  // an empty form and a fresh idempotency key.
  return (
    <Modal opened={opened} onClose={onClose} title={t('ledger.newTransaction')} size="lg">
      <NewLedgerTransactionForm onClose={onClose} me={me} />
    </Modal>
  );
};

const NewLedgerTransactionForm = ({
  onClose,
  me,
}: Omit<NewLedgerTransactionModalProps, 'opened'>) => {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const post = usePostLedgerTransaction();

  const [intent, setIntent] = useState<LedgerIntentEnum>('expense_for_community');
  const [amount, setAmount] = useState<number | string>('');
  const [occurredOn, setOccurredOn] = useState(today);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [counterparty, setCounterparty] = useState<string | null>(null);
  const [via, setVia] = useState<LedgerViaEnum>('bank');
  const [receipts, setReceipts] = useState<File[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  // One key per opened form: a double submit posts once (the server replays it).
  const [clientKey] = useState(() => crypto.randomUUID());

  const categoryKind = NEEDS_CATEGORY[intent];
  const { data: categories } = useLedgerCategories(categoryKind);
  const { data: projects } = useLedgerProjects();
  const { data: members } = useLedgerMembers(NEEDS_COUNTERPARTY.has(intent));

  const intents = me.is_ledger_admin ? [...MEMBER_INTENTS, ...TREASURER_INTENTS] : MEMBER_INTENTS;
  const memberOptions = useMemo(
    () =>
      (members ?? [])
        .filter(member => intent !== 'member_to_member' || member.id !== me.id)
        .map(member => ({ value: member.id, label: member.name })),
    [members, intent, me.id],
  );

  const effect = MY_EFFECT[intent];
  const numericAmount = typeof amount === 'number' ? amount : Number(amount);

  const handleSubmit = async () => {
    setErrors({});
    try {
      const transaction = await post.mutateAsync({
        intent,
        amount: numericAmount.toFixed(2),
        occurred_on: occurredOn,
        description,
        category: categoryKind ? category : null,
        project,
        counterparty: NEEDS_COUNTERPARTY.has(intent) ? counterparty : null,
        via,
        client_key: clientKey,
        receipts,
      });
      onClose();
      navigate(ledgerTransactionPath(transaction.id));
    } catch (error) {
      const found = fieldErrors(error);
      setErrors(Object.keys(found).length ? found : { non_field_errors: t('ledger.postFailed') });
    }
  };

  return (
    <Stack gap="sm">
      <Select
        label={t('ledger.intent.label')}
        data={intents.map(value => ({ value, label: t(`ledger.intent.${value}`) }))}
        value={intent}
        onChange={value => value && setIntent(value as LedgerIntentEnum)}
        allowDeselect={false}
        error={errors.intent}
      />
      <Text size="sm" c="dimmed">
        {t(`ledger.intentHelp.${intent}`)}
      </Text>

      <Group grow align="flex-start">
        <NumberInput
          label={t('ledger.amount')}
          value={amount}
          onChange={setAmount}
          min={0.01}
          decimalScale={2}
          fixedDecimalScale
          decimalSeparator={language === 'de' ? ',' : '.'}
          leftSection={<Text size="sm">€</Text>}
          required
          error={errors.amount}
        />
        <TextInput
          type="date"
          label={t('ledger.date')}
          value={occurredOn}
          max={today()}
          onChange={event => setOccurredOn(event.currentTarget.value)}
          required
          error={errors.occurred_on}
        />
      </Group>

      <Textarea
        label={t('ledger.description')}
        placeholder={t(`ledger.descriptionPlaceholder.${intent}`)}
        value={description}
        onChange={event => setDescription(event.currentTarget.value)}
        autosize
        minRows={2}
        required
        error={errors.description}
      />

      {categoryKind && (
        <Select
          label={t('ledger.category')}
          data={(categories ?? []).map(c => ({ value: c.id, label: categoryLabel(c, t) }))}
          value={category}
          onChange={setCategory}
          required
          error={errors.category}
        />
      )}

      {NEEDS_COUNTERPARTY.has(intent) && (
        <Select
          label={t(intent === 'payout' ? 'ledger.counterpartyPayout' : 'ledger.counterpartyOwe')}
          data={memberOptions}
          value={counterparty}
          onChange={setCounterparty}
          searchable
          required
          error={errors.counterparty}
        />
      )}

      {NEEDS_VIA.has(intent) && (
        <div>
          <Text size="sm" fw={500} mb={4}>
            {t('ledger.via')}
          </Text>
          <SegmentedControl
            value={via}
            onChange={value => setVia(value as LedgerViaEnum)}
            data={[
              { value: 'bank', label: t('ledger.viaBank') },
              { value: 'cash', label: t('ledger.viaCash') },
            ]}
          />
        </div>
      )}

      {(projects ?? []).length > 0 && (
        <Select
          label={t('ledger.project')}
          data={(projects ?? []).map(p => ({ value: p.id, label: p.name }))}
          value={project}
          onChange={setProject}
          clearable
          error={errors.project}
        />
      )}

      <FileInput
        label={t('ledger.receipts')}
        description={
          intent === 'expense_for_community' ? t('ledger.receiptsNudge') : t('ledger.receiptsHelp')
        }
        placeholder={t('ledger.receiptsPlaceholder')}
        accept={RECEIPT_TYPES}
        multiple
        clearable
        value={receipts}
        onChange={setReceipts}
        leftSection={<Paperclip size={16} aria-hidden="true" />}
        error={errors.receipts}
      />

      {effect !== undefined && numericAmount > 0 && (
        <Text size="sm">
          {t('ledger.previewEffect', {
            amount: formatMoney(effect * numericAmount, me.currency, language, { signed: true }),
          })}
        </Text>
      )}

      {errors.non_field_errors && <Alert color="red">{errors.non_field_errors}</Alert>}

      <Text size="xs" c="dimmed">
        {t('ledger.publicNotice')}
      </Text>

      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button onClick={() => void handleSubmit()} loading={post.isPending}>
          {t('ledger.post')}
        </Button>
      </Group>
    </Stack>
  );
};
