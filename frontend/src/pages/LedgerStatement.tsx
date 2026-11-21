import { BackButton } from '@/components/layout/BackButton';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDownloadStatementCsv, useLedgerStatement, useMyLedgerAccount } from '@/hooks/useLedger';
import { formatMoney } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import { recentYears } from '@/lib/ledger';
import { ledgerTransactionPath } from '@/lib/routes';
import {
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
import { Download, Printer } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

const Figure = ({ label, value }: { label: string; value: string }) => (
  <div>
    <Text size="xs" c="dimmed">
      {label}
    </Text>
    <Text fw={700} className="tabular-nums">
      {value}
    </Text>
  </div>
);

/**
 * A statement for one year (plan D12): every line that made the balance, with
 * the balance before, after each line and at the end. Printable, so a member
 * can save it as PDF from the browser, and downloadable as CSV.
 */
const LedgerStatement = () => {
  const { accountId } = useParams<{ accountId?: string }>();
  const { t, language } = useLanguage();
  const [params, setParams] = useSearchParams();
  const { data: me } = useMyLedgerAccount();
  const id = accountId ?? me?.id;
  const years = recentYears();
  const year = Number(params.get('year')) || years[0];
  const period = { date_from: `${year}-01-01`, date_to: `${year}-12-31` };
  const { data: statement, isLoading, isError } = useLedgerStatement(id, period);
  const csv = useDownloadStatementCsv();

  const money = (value: string, signed = false) =>
    formatMoney(value, statement?.currency ?? 'EUR', language, { signed });

  return (
    <main className="container mx-auto max-w-3xl px-4 py-4">
      <Stack gap="md">
        <Group justify="space-between" className="print-hide">
          <Group gap="sm">
            <BackButton />
            <Title order={1} size="h3">
              {t('ledger.statementPage.title')}
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
              disabled={!id}
              onClick={() => id && csv.mutate({ accountId: id, period })}
            >
              CSV
            </Button>
            <Button
              leftSection={<Printer size={16} aria-hidden="true" />}
              onClick={() => window.print()}
              disabled={!statement}
            >
              {t('ledger.print')}
            </Button>
          </Group>
        </Group>

        {isLoading || !id ? (
          <Text c="dimmed" className="py-8 text-center">
            {t('common.loading')}
          </Text>
        ) : isError || !statement ? (
          <Text c="red" className="py-8 text-center">
            {t('common.loadingError')}
          </Text>
        ) : (
          <>
            <div>
              <Title order={2} size="h4">
                {t('ledger.statementPage.heading', { name: statement.account.name })}
              </Title>
              <Text size="sm" c="dimmed">
                {formatDate(statement.date_from, language)} –{' '}
                {formatDate(statement.date_to, language)} ·{' '}
                {t('ledger.statementPage.created', {
                  date: formatDate(new Date(), language),
                })}
              </Text>
            </div>

            <Card withBorder padding="sm">
              <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
                <Figure
                  label={t('ledger.statementPage.opening')}
                  value={money(statement.opening_balance, true)}
                />
                <Figure
                  label={t('ledger.statementPage.credited')}
                  value={money(statement.credited)}
                />
                <Figure
                  label={t('ledger.statementPage.charged')}
                  value={money(statement.charged)}
                />
                <Figure
                  label={t('ledger.statementPage.closing')}
                  value={money(statement.closing_balance, true)}
                />
              </SimpleGrid>
              <Text size="xs" c="dimmed" mt="xs">
                {t('ledger.statementPage.signHelp')}
              </Text>
            </Card>

            {statement.lines.length === 0 ? (
              <Text c="dimmed" className="py-4 text-center">
                {t('ledger.statementPage.empty')}
              </Text>
            ) : (
              <Table striped fz="sm" withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('ledger.date')}</Table.Th>
                    <Table.Th>{t('ledger.description')}</Table.Th>
                    <Table.Th className="text-right">{t('ledger.amount')}</Table.Th>
                    <Table.Th className="text-right">{t('ledger.statementPage.balance')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {statement.lines.map(line => (
                    <Table.Tr key={line.entry}>
                      <Table.Td className="whitespace-nowrap">
                        {formatDate(line.occurred_on, language)}
                      </Table.Td>
                      <Table.Td>
                        <Anchor component={Link} to={ledgerTransactionPath(line.transaction)}>
                          {line.description}
                        </Anchor>
                        <Text size="xs" c="dimmed">
                          #{line.seq} · {t(`ledger.kind.${line.kind}`)}
                        </Text>
                      </Table.Td>
                      <Table.Td className="text-right tabular-nums whitespace-nowrap">
                        {money(line.amount, true)}
                      </Table.Td>
                      <Table.Td className="text-right tabular-nums whitespace-nowrap">
                        {money(line.balance_after, true)}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </>
        )}
      </Stack>
    </main>
  );
};

export default LedgerStatement;
