import { useLanguage } from '@/contexts/LanguageContext';
import {
  useLedgerCategories,
  useLedgerMembers,
  useLedgerProjects,
  useSaveCostShare,
} from '@/hooks/useLedger';
import { formatMoney } from '@/lib/currency';
import {
  RECEIPT_TYPES,
  allocateCents,
  categoryLabel,
  type FieldErrors,
  fieldErrors,
  today,
} from '@/lib/ledger';
import { ledgerCostSharePath } from '@/lib/routes';
import type { LedgerCostShare, LedgerCostShareSplitEnum, LedgerMyAccount } from '@/services/django';
import {
  Alert,
  Button,
  Checkbox,
  FileInput,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { Paperclip } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface CostShareModalProps {
  opened: boolean;
  onClose: () => void;
  me: LedgerMyAccount;
  /** Change this open split instead of creating one. */
  costShare?: LedgerCostShare;
}

interface ParticipantRow {
  weight: number | string;
  amount: number | string;
  guests: number | string;
}

/**
 * Split a cost among members (plan 7a): "I paid 60 € for dinner, split with
 * Bob and Carla". Each participant is told their share and accepts or
 * objects; silence counts as acceptance after the deadline.
 */
export const CostShareModal = ({ opened, onClose, me, costShare }: CostShareModalProps) => {
  const { t } = useLanguage();
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={costShare ? t('ledger.split.editTitle') : t('ledger.split.newTitle')}
      size="lg"
    >
      <CostShareForm onClose={onClose} me={me} costShare={costShare} />
    </Modal>
  );
};

const num = (value: number | string) => (value === '' ? 0 : Number(value));

const CostShareForm = ({ onClose, me, costShare }: Omit<CostShareModalProps, 'opened'>) => {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const save = useSaveCostShare();
  const { data: members } = useLedgerMembers(true);
  const { data: categories } = useLedgerCategories('expense');
  const { data: projects } = useLedgerProjects();

  const [description, setDescription] = useState(costShare?.description ?? '');
  const [total, setTotal] = useState<number | string>(costShare ? Number(costShare.total) : '');
  const [occurredOn, setOccurredOn] = useState(costShare?.occurred_on ?? today());
  const [split, setSplit] = useState<LedgerCostShareSplitEnum>(costShare?.split ?? 'equal');
  const [category, setCategory] = useState<string | null>(costShare?.category?.id ?? null);
  const [project, setProject] = useState<string | null>(costShare?.project?.id ?? null);
  const [payerParticipates, setPayerParticipates] = useState(costShare?.payer_participates ?? true);
  const [payerWeight, setPayerWeight] = useState<number | string>(
    costShare ? Number(costShare.payer_weight) : 1,
  );
  const [payerGuests, setPayerGuests] = useState<number | string>(costShare?.payer_guests ?? 0);
  const [selected, setSelected] = useState<string[]>(
    costShare?.participants.map(p => p.account.id) ?? [],
  );
  const [rows, setRows] = useState<Record<string, ParticipantRow>>(() =>
    Object.fromEntries(
      (costShare?.participants ?? []).map(p => [
        p.account.id,
        { weight: Number(p.weight), amount: p.amount ? Number(p.amount) : '', guests: p.guests },
      ]),
    ),
  );
  const [receipts, setReceipts] = useState<File[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});

  const names = useMemo(
    () =>
      Object.fromEntries([
        // Participants who are no longer listed (e.g. inactive) keep their name.
        ...(costShare?.participants ?? []).map(p => [p.account.id, p.account.name]),
        ...(members ?? []).map(member => [member.id, member.name]),
      ]) as Record<string, string>,
    [members, costShare],
  );
  const options = (members ?? [])
    .filter(member => member.id !== me.id)
    .map(member => ({ value: member.id, label: member.name }));
  const row = (id: string): ParticipantRow => rows[id] ?? { weight: 1, amount: '', guests: 0 };
  const setRow = (id: string, change: Partial<ParticipantRow>) =>
    setRows(prev => ({ ...prev, [id]: { ...row(id), ...change } }));

  // Preview, computed like the server does (largest remainder, payer last).
  const totalValue = num(total);
  const preview = (() => {
    if (split === 'amounts') {
      const shares = selected.map(id => num(row(id).amount));
      return { shares, payer: totalValue - shares.reduce((a, b) => a + b, 0) };
    }
    const units = (weight: number, guests: number) =>
      (split === 'equal' ? 1 : weight) * (1 + guests);
    const weights = selected.map(id => units(num(row(id).weight), num(row(id).guests)));
    const payerUnits = payerParticipates ? units(num(payerWeight), num(payerGuests)) : 0;
    const parts = allocateCents(totalValue, [...weights, payerUnits]);
    return { shares: parts.slice(0, -1), payer: parts[parts.length - 1] };
  })();

  const money = (value: number) => formatMoney(value, me.currency, language);
  const decimal = language === 'de' ? ',' : '.';

  const handleSubmit = async () => {
    setErrors({});
    try {
      const saved = await save.mutateAsync({
        id: costShare?.id,
        description,
        total: totalValue.toFixed(2),
        occurred_on: occurredOn,
        split,
        category,
        project,
        payer_participates: payerParticipates,
        payer_weight: num(payerWeight).toFixed(2),
        payer_guests: num(payerGuests),
        participants: selected.map(id => ({
          account: id,
          weight: num(row(id).weight).toFixed(2),
          amount: split === 'amounts' ? num(row(id).amount).toFixed(2) : null,
          guests: num(row(id).guests),
        })),
        receipts,
      });
      onClose();
      navigate(ledgerCostSharePath(saved.id));
    } catch (error) {
      const found = fieldErrors(error);
      setErrors(Object.keys(found).length ? found : { non_field_errors: t('ledger.postFailed') });
    }
  };

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {t('ledger.split.help')}
      </Text>
      <Textarea
        label={t('ledger.description')}
        placeholder={t('ledger.split.descriptionPlaceholder')}
        value={description}
        onChange={event => setDescription(event.currentTarget.value)}
        autosize
        minRows={1}
        required
        error={errors.description}
      />
      <Group grow align="flex-start">
        <NumberInput
          label={t('ledger.split.total')}
          value={total}
          onChange={setTotal}
          min={0.01}
          decimalScale={2}
          fixedDecimalScale
          decimalSeparator={decimal}
          leftSection={<Text size="sm">€</Text>}
          required
          error={errors.total}
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

      <MultiSelect
        label={t('ledger.split.participants')}
        description={t('ledger.split.participantsHelp')}
        data={options}
        value={selected}
        onChange={setSelected}
        searchable
        required
        error={errors.participants}
      />

      <div>
        <Text size="sm" fw={500} mb={4}>
          {t('ledger.split.how')}
        </Text>
        <SegmentedControl
          value={split}
          onChange={value => setSplit(value as LedgerCostShareSplitEnum)}
          data={[
            { value: 'equal', label: t('ledger.split.equal') },
            { value: 'weights', label: t('ledger.split.weights') },
            { value: 'amounts', label: t('ledger.split.amounts') },
          ]}
        />
      </div>

      {split !== 'amounts' && (
        <Checkbox
          label={t('ledger.split.payerParticipates')}
          checked={payerParticipates}
          onChange={event => setPayerParticipates(event.currentTarget.checked)}
        />
      )}

      {selected.length > 0 && (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('ledger.split.member')}</Table.Th>
              {split === 'weights' && <Table.Th>{t('ledger.split.weight')}</Table.Th>}
              {split !== 'amounts' && <Table.Th>{t('ledger.split.guests')}</Table.Th>}
              {split === 'amounts' && <Table.Th>{t('ledger.amount')}</Table.Th>}
              <Table.Th className="text-right">{t('ledger.split.share')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {selected.map((id, index) => (
              <Table.Tr key={id}>
                <Table.Td>
                  <Text size="sm">{names[id] ?? id}</Text>
                </Table.Td>
                {split === 'weights' && (
                  <Table.Td>
                    <NumberInput
                      size="xs"
                      className="w-20"
                      aria-label={t('ledger.split.weight')}
                      value={row(id).weight}
                      onChange={value => setRow(id, { weight: value })}
                      min={0.01}
                      decimalScale={2}
                      decimalSeparator={decimal}
                    />
                  </Table.Td>
                )}
                {split !== 'amounts' && (
                  <Table.Td>
                    <NumberInput
                      size="xs"
                      className="w-20"
                      aria-label={t('ledger.split.guests')}
                      value={row(id).guests}
                      onChange={value => setRow(id, { guests: value })}
                      min={0}
                      max={100}
                      allowDecimal={false}
                    />
                  </Table.Td>
                )}
                {split === 'amounts' && (
                  <Table.Td>
                    <NumberInput
                      size="xs"
                      className="w-28"
                      aria-label={t('ledger.amount')}
                      value={row(id).amount}
                      onChange={value => setRow(id, { amount: value })}
                      min={0.01}
                      decimalScale={2}
                      decimalSeparator={decimal}
                    />
                  </Table.Td>
                )}
                <Table.Td className="text-right">
                  <Text size="sm" fw={600}>
                    {money(preview.shares[index] ?? 0)}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
            <Table.Tr>
              <Table.Td>
                <Text size="sm" c="dimmed">
                  {t('ledger.split.you')}
                </Text>
              </Table.Td>
              {split === 'weights' && (
                <Table.Td>
                  {payerParticipates && (
                    <NumberInput
                      size="xs"
                      className="w-20"
                      aria-label={t('ledger.split.weight')}
                      value={payerWeight}
                      onChange={setPayerWeight}
                      min={0.01}
                      decimalScale={2}
                      decimalSeparator={decimal}
                    />
                  )}
                </Table.Td>
              )}
              {split !== 'amounts' && (
                <Table.Td>
                  {payerParticipates && (
                    <NumberInput
                      size="xs"
                      className="w-20"
                      aria-label={t('ledger.split.guests')}
                      value={payerGuests}
                      onChange={setPayerGuests}
                      min={0}
                      max={100}
                      allowDecimal={false}
                    />
                  )}
                </Table.Td>
              )}
              {split === 'amounts' && <Table.Td />}
              <Table.Td className="text-right">
                <Text size="sm" c={preview.payer < 0 ? 'red' : 'dimmed'}>
                  {money(preview.payer)}
                </Text>
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      )}
      {split !== 'amounts' && selected.length > 0 && (
        <Text size="xs" c="dimmed">
          {t('ledger.split.guestsHelp')}
        </Text>
      )}

      <Select
        label={t('ledger.category')}
        data={(categories ?? []).map(c => ({ value: c.id, label: categoryLabel(c, t) }))}
        value={category}
        onChange={setCategory}
        clearable
        error={errors.category}
      />
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
        description={t('ledger.receiptsNudge')}
        placeholder={t('ledger.receiptsPlaceholder')}
        accept={RECEIPT_TYPES}
        multiple
        clearable
        value={receipts}
        onChange={setReceipts}
        leftSection={<Paperclip size={16} aria-hidden="true" />}
        error={errors.receipts ?? errors.file}
      />

      {totalValue > 0 && selected.length > 0 && (
        <Text size="sm">
          {t('ledger.split.previewCredit', {
            amount: formatMoney(totalValue - Math.max(preview.payer, 0), me.currency, language, {
              signed: true,
            }),
          })}
        </Text>
      )}
      {errors.non_field_errors && <Alert color="red">{errors.non_field_errors}</Alert>}
      <Text size="xs" c="dimmed">
        {costShare ? t('ledger.split.editNotice') : t('ledger.split.consentNotice')}
      </Text>

      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button onClick={() => void handleSubmit()} loading={save.isPending}>
          {costShare ? t('ledger.split.saveChanges') : t('ledger.split.send')}
        </Button>
      </Group>
    </Stack>
  );
};
