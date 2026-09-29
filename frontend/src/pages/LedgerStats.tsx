import { BackButton } from '@/components/layout/BackButton';
import {
  BarList,
  type BarRow,
  type BarValue,
  MonthColumns,
  type MonthPoint,
  type Series,
  SeriesLegend,
} from '@/components/ledger/StatsCharts';
import { useLanguage } from '@/contexts/LanguageContext';
import { useLedgerStats } from '@/hooks/useLedger';
import { formatMoney } from '@/lib/currency';
import { type PeriodPreset, periodRange, statsRowLabel } from '@/lib/ledger';
import { LEDGER_PATH, LEDGER_REPORT_PATH, ledgerAccountPath } from '@/lib/routes';
import type { LedgerStatsGroupEnum, LedgerStatsRow } from '@/services/django';
import {
  Anchor,
  Card,
  Group,
  Progress,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { AlertTriangle } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

const GROUPS: LedgerStatsGroupEnum[] = ['category', 'project', 'month', 'member', 'item'];
const PERIODS: PeriodPreset[] = ['this-year', 'last-year', 'last-12-months', 'all'];

const num = (value: string) => Number(value);

/** Every month from the first to the last booked one, empty months as zero. */
const monthPoints = (rows: LedgerStatsRow[], language: 'en' | 'de'): MonthPoint[] => {
  if (!rows.length) return [];
  const byMonth = new Map(rows.map(row => [row.label, row]));
  const [firstYear, firstMonth] = rows[0].label.split('-').map(Number);
  const [lastYear, lastMonth] = rows[rows.length - 1].label.split('-').map(Number);
  const points: MonthPoint[] = [];
  for (let y = firstYear, m = firstMonth; y < lastYear || (y === lastYear && m <= lastMonth);) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const row = byMonth.get(key);
    const date = new Date(y, m - 1, 1);
    const month = date.toLocaleDateString(language === 'de' ? 'de-DE' : 'en-GB', {
      month: 'short',
    });
    points.push({
      key,
      label: key,
      // The year only where it changes, so a long period stays readable.
      short: points.length === 0 || m === 1 ? `${month} ${String(y).slice(2)}` : month,
      first: row ? num(row.income) : 0,
      second: row ? num(row.expense) : 0,
    });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return points;
};

/** A headline figure: a number with its label, no chart. */
const StatTile = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <Card withBorder padding="sm">
    <Text size="xs" c="dimmed">
      {label}
    </Text>
    <Text size="xl" fw={700} className="tabular-nums">
      {value}
    </Text>
    {hint && (
      <Text size="xs" c="dimmed">
        {hint}
      </Text>
    )}
  </Card>
);

/**
 * Where the money comes from and goes (plan D7): totals for a period, then the
 * same figures by category, project, month, member or item. Reversals and
 * corrections count against what they undo.
 */
const LedgerStats = () => {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const groupBy = (GROUPS as string[]).includes(params.get('group') ?? '')
    ? (params.get('group') as LedgerStatsGroupEnum)
    : 'category';
  const period = (PERIODS as string[]).includes(params.get('period') ?? '')
    ? (params.get('period') as PeriodPreset)
    : 'this-year';
  const query = useMemo(() => ({ group_by: groupBy, ...periodRange(period) }), [groupBy, period]);
  const { data, isLoading, isError } = useLedgerStats(query);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  };

  const currency = data?.currency ?? 'EUR';
  const money = (value: string | number) => formatMoney(value, currency, language);
  const incomeSeries: [Series, Series] = [
    { slot: 'first', label: t('ledger.stats.income') },
    { slot: 'second', label: t('ledger.stats.expense') },
  ];

  /** Income and expense bars; a neutral "money moved" bar for transfers. */
  const moneyValues = (row: LedgerStatsRow): BarValue[] => {
    const values: BarValue[] = [];
    if (num(row.income)) values.push({ ...incomeSeries[0], value: num(row.income) });
    if (num(row.expense)) values.push({ ...incomeSeries[1], value: num(row.expense) });
    if (!values.length)
      values.push({ slot: 'neutral', label: t('ledger.stats.moved'), value: num(row.amount) });
    return values;
  };
  const countHint = (row: LedgerStatsRow) => t('ledger.stats.count', { count: row.count });
  const label = (row: LedgerStatsRow) => statsRowLabel(row, groupBy, t);
  const feedLink = (key: string, value: string | null) => () =>
    value && navigate(`${LEDGER_PATH}?${key}=${value}`);

  const rows: BarRow[] = (data?.rows ?? [])
    .filter(row => num(row.amount) || num(row.income) || num(row.expense) || num(row.credited))
    .map(row => {
      switch (groupBy) {
        case 'member':
          return {
            key: row.key ?? 'none',
            label: row.label,
            values: [
              { slot: 'first', label: t('ledger.stats.credited'), value: num(row.credited) },
              { slot: 'second', label: t('ledger.stats.charged'), value: num(row.charged) },
            ],
            hint: countHint(row),
            onClick: () => row.key && navigate(ledgerAccountPath(row.key)),
          };
        case 'item':
          return {
            key: row.key ?? 'none',
            label: row.label,
            values: [{ slot: 'first', label: t('ledger.stats.charged'), value: num(row.amount) }],
            hint: countHint(row),
            onClick: () => row.key && navigate(`/item/${row.key}`),
          };
        case 'project': {
          const budget = row.budget ? num(row.budget) : null;
          const spent = num(row.expense);
          const over = budget !== null && spent > budget;
          return {
            key: row.key ?? 'none',
            label: row.key ? row.label : t('ledger.stats.noProject'),
            values: moneyValues(row),
            hint: countHint(row),
            onClick: feedLink('project', row.key),
            footer: budget !== null && (
              <Stack gap={2} className="mt-1">
                <Progress
                  value={budget ? Math.min(100, (spent / budget) * 100) : 100}
                  color={over ? 'red' : 'gray'}
                  size="sm"
                  aria-label={t('ledger.stats.budget')}
                />
                <Group gap={4}>
                  {over && <AlertTriangle size={12} aria-hidden="true" color="red" />}
                  <Text size="xs" c={over ? 'red' : 'dimmed'}>
                    {t(over ? 'ledger.stats.overBudget' : 'ledger.stats.ofBudget', {
                      spent: money(spent),
                      budget: money(budget),
                    })}
                  </Text>
                </Group>
              </Stack>
            ),
          };
        }
        default:
          return {
            key: row.key ?? 'none',
            label: row.key ? label(row) : t('ledger.stats.uncategorised'),
            values: moneyValues(row),
            hint: countHint(row),
            onClick: feedLink('category', row.key),
          };
      }
    });

  const groupOptions = GROUPS.map(value => ({ value, label: t(`ledger.stats.by.${value}`) }));
  // Only the series actually drawn; a single series needs no legend.
  const drawn = new Map(rows.flatMap(row => row.values).map(v => [v.slot, v.label]));
  // Fixed order, so a colour keeps its place whatever the ranking.
  const legend: Series[] =
    drawn.size > 1
      ? (['first', 'second', 'neutral'] as const)
          .filter(slot => drawn.has(slot))
          .map(slot => ({ slot, label: drawn.get(slot)! }))
      : [];

  const totals = data?.totals;
  const result = totals ? num(totals.income) - num(totals.expense) : 0;

  return (
    <main className="container mx-auto max-w-3xl px-4 py-4">
      <Stack gap="md">
        <Group justify="space-between">
          <Group gap="sm">
            <BackButton />
            <Title order={1} size="h3">
              {t('ledger.stats.title')}
            </Title>
          </Group>
          <Anchor component={Link} to={LEDGER_REPORT_PATH} size="sm">
            {t('ledger.report.title')}
          </Anchor>
        </Group>

        <Select
          className="max-w-xs"
          aria-label={t('ledger.stats.period')}
          data={PERIODS.map(value => ({ value, label: t(`ledger.stats.periods.${value}`) }))}
          value={period}
          onChange={value => value && setParam('period', value)}
          allowDeselect={false}
        />

        {totals && (
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
            <StatTile label={t('ledger.stats.income')} value={money(totals.income)} />
            <StatTile label={t('ledger.stats.expense')} value={money(totals.expense)} />
            <StatTile
              label={t('ledger.stats.result')}
              value={formatMoney(result, currency, language, { signed: true })}
              hint={t(result < 0 ? 'ledger.stats.deficit' : 'ledger.stats.surplus')}
            />
            <StatTile
              label={t('ledger.stats.transactions')}
              value={String(totals.count)}
              hint={t('ledger.stats.moved') + ': ' + money(totals.amount)}
            />
          </SimpleGrid>
        )}

        <SegmentedControl
          visibleFrom="sm"
          fullWidth
          value={groupBy}
          onChange={value => setParam('group', value)}
          data={groupOptions}
        />
        <Select
          hiddenFrom="sm"
          aria-label={t('ledger.stats.groupBy')}
          data={groupOptions}
          value={groupBy}
          onChange={value => value && setParam('group', value)}
          allowDeselect={false}
        />

        <Card withBorder padding="md">
          {isLoading ? (
            <Text c="dimmed" className="py-8 text-center">
              {t('common.loading')}
            </Text>
          ) : isError ? (
            <Text c="red" className="py-8 text-center">
              {t('common.loadingError')}
            </Text>
          ) : rows.length === 0 ? (
            <Text c="dimmed" className="py-8 text-center">
              {t('ledger.stats.empty')}
            </Text>
          ) : groupBy === 'month' ? (
            <MonthColumns
              currency={currency}
              series={incomeSeries}
              points={monthPoints(data?.rows ?? [], language)}
            />
          ) : (
            <Stack gap="md">
              {legend.length > 0 && <SeriesLegend series={legend} />}
              <BarList rows={rows} currency={currency} />
            </Stack>
          )}
        </Card>
        <Text size="xs" c="dimmed">
          {t(`ledger.stats.help.${groupBy}`)} {t('ledger.stats.reversalsNote')}
        </Text>
      </Stack>
    </main>
  );
};

export default LedgerStats;
