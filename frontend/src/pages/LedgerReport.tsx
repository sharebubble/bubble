import { BackButton } from '@/components/layout/BackButton';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDownloadAnnualReportCsv, useLedgerAnnualReport } from '@/hooks/useLedger';
import { formatMoney } from '@/lib/currency';
import { recentYears, statsRowLabel } from '@/lib/ledger';
import { ledgerAccountPath } from '@/lib/routes';
import type { LedgerAccountPosition, LedgerStatsRow } from '@/services/django';
import {
  Alert,
  Anchor,
  Button,
  Card,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { AlertTriangle, CheckCircle2, Download, Printer } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <Card withBorder padding="sm" className="break-inside-avoid">
    <Title order={2} size="h5" mb="xs">
      {title}
    </Title>
    {children}
  </Card>
);

/**
 * The treasurer's yearly overview (plan section 13), open to every member
 * (D8): income and expenses by category and project, what members are owed or
 * owe at year end, where the money is, and the check that it all adds up.
 * Printable (save as PDF) and downloadable as CSV.
 */
const LedgerReport = () => {
  const { t, language } = useLanguage();
  const [params, setParams] = useSearchParams();
  const years = recentYears();
  const year = Number(params.get('year')) || years[0];
  const { data: report, isLoading, isError } = useLedgerAnnualReport(year);
  const csv = useDownloadAnnualReportCsv();

  const money = (value: string | number, signed = false) =>
    formatMoney(value, report?.currency ?? 'EUR', language, { signed });

  const categoryTable = (rows: LedgerStatsRow[], field: 'income' | 'expense', total: string) => (
    <Table fz="sm">
      <Table.Tbody>
        {rows.map(row => (
          <Table.Tr key={row.key ?? 'none'}>
            <Table.Td>
              {row.key ? statsRowLabel(row, 'category', t) : t('ledger.stats.uncategorised')}
            </Table.Td>
            <Table.Td className="text-right tabular-nums">{money(row[field])}</Table.Td>
          </Table.Tr>
        ))}
        <Table.Tr>
          <Table.Td fw={700}>{t('ledger.report.total')}</Table.Td>
          <Table.Td fw={700} className="text-right tabular-nums">
            {money(total)}
          </Table.Td>
        </Table.Tr>
      </Table.Tbody>
    </Table>
  );

  /** System accounts are seeded in English; translate the known ones. */
  const accountLabel = (code: string, name: string) => {
    const key = `ledger.report.account.${code}`;
    const translated = t(key);
    return translated === key ? name : translated;
  };

  const positions = (rows: LedgerAccountPosition[], link = false) => (
    <Table fz="sm">
      <Table.Thead>
        <Table.Tr>
          <Table.Th />
          <Table.Th className="text-right">{t('ledger.report.opening')}</Table.Th>
          <Table.Th className="text-right">{t('ledger.report.closing')}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map(row => (
          <Table.Tr key={row.account.id}>
            <Table.Td>
              {link ? (
                <Anchor component={Link} to={ledgerAccountPath(row.account.id)}>
                  {row.account.name}
                </Anchor>
              ) : (
                accountLabel(row.account.code, row.account.name)
              )}
            </Table.Td>
            <Table.Td className="text-right tabular-nums">{money(row.opening, link)}</Table.Td>
            <Table.Td className="text-right tabular-nums">{money(row.closing, link)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );

  return (
    <main className="container mx-auto max-w-3xl px-4 py-4">
      <Stack gap="md">
        <Group justify="space-between" className="print-hide">
          <Group gap="sm">
            <BackButton />
            <Title order={1} size="h3">
              {t('ledger.report.title')}
            </Title>
          </Group>
          <Group gap="xs">
            <Select
              className="w-28"
              aria-label={t('ledger.statementPage.year')}
              data={years.map(String)}
              value={String(year)}
              onChange={value => value && setParams({ year: value }, { replace: true })}
              allowDeselect={false}
            />
            <Button
              variant="default"
              leftSection={<Download size={16} aria-hidden="true" />}
              loading={csv.isPending}
              onClick={() => csv.mutate(year)}
            >
              CSV
            </Button>
            <Button
              leftSection={<Printer size={16} aria-hidden="true" />}
              onClick={() => window.print()}
              disabled={!report}
            >
              {t('ledger.print')}
            </Button>
          </Group>
        </Group>

        {isLoading ? (
          <Text c="dimmed" className="py-8 text-center">
            {t('common.loading')}
          </Text>
        ) : isError || !report ? (
          <Text c="red" className="py-8 text-center">
            {t('common.loadingError')}
          </Text>
        ) : (
          <>
            <Title order={2} size="h4">
              {t('ledger.report.heading', { year: report.year })}
            </Title>

            <Section title={t('ledger.report.summary')}>
              <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
                {[
                  [t('ledger.stats.income'), money(report.total_income)],
                  [t('ledger.stats.expense'), money(report.total_expense)],
                  [t('ledger.stats.result'), money(report.result, true)],
                  [t('ledger.stats.transactions'), String(report.transactions)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <Text size="xs" c="dimmed">
                      {label}
                    </Text>
                    <Text fw={700} className="tabular-nums">
                      {value}
                    </Text>
                  </div>
                ))}
              </SimpleGrid>
            </Section>

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <Section title={t('ledger.stats.income')}>
                {categoryTable(report.income, 'income', report.total_income)}
              </Section>
              <Section title={t('ledger.stats.expense')}>
                {categoryTable(report.expense, 'expense', report.total_expense)}
              </Section>
            </SimpleGrid>

            {report.projects.length > 0 && (
              <Section title={t('ledger.report.projects')}>
                <Table fz="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th />
                      <Table.Th className="text-right">{t('ledger.stats.income')}</Table.Th>
                      <Table.Th className="text-right">{t('ledger.stats.expense')}</Table.Th>
                      <Table.Th className="text-right">{t('ledger.stats.budget')}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {report.projects.map(row => (
                      <Table.Tr key={row.key}>
                        <Table.Td>{row.label}</Table.Td>
                        <Table.Td className="text-right tabular-nums">{money(row.income)}</Table.Td>
                        <Table.Td className="text-right tabular-nums">
                          {money(row.expense)}
                        </Table.Td>
                        <Table.Td className="text-right tabular-nums">
                          {row.budget ? money(row.budget) : '—'}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Section>
            )}

            <Section title={t('ledger.report.money')}>
              {positions(report.money)}
              <Text size="sm" mt="xs">
                {t('ledger.report.moneyChange', { amount: money(report.money_change, true) })}
              </Text>
            </Section>

            <Section title={t('ledger.report.members')}>
              <Text size="sm" mb="xs">
                {t('ledger.report.membersSummary', {
                  owed: money(report.owed_to_members),
                  owing: money(report.owed_by_members),
                })}
              </Text>
              {positions(report.members, true)}
              <Text size="xs" c="dimmed" mt="xs">
                {t('ledger.statementPage.signHelp')}
              </Text>
            </Section>

            {report.other.length > 0 && (
              <Section title={t('ledger.report.other')}>{positions(report.other)}</Section>
            )}

            {report.reconciles ? (
              <Alert
                color="gray"
                icon={<CheckCircle2 size={16} aria-hidden="true" />}
                title={t('ledger.report.checkOk')}
              >
                {t('ledger.report.checkOkBody', {
                  change: money(report.money_change, true),
                  result: money(report.result, true),
                })}
              </Alert>
            ) : (
              <Alert
                color="red"
                icon={<AlertTriangle size={16} aria-hidden="true" />}
                title={t('ledger.report.checkFailed')}
              >
                {t('ledger.report.checkFailedBody', {
                  trial: money(report.trial_balance),
                })}
              </Alert>
            )}
          </>
        )}
      </Stack>
    </main>
  );
};

export default LedgerReport;
