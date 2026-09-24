import { BackButton } from '@/components/layout/BackButton';
import { HashValue } from '@/components/ledger/HashValue';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDownloadChainCsv, useLedgerChain } from '@/hooks/useLedger';
import { formatDate } from '@/lib/date';
import { shortHash } from '@/lib/ledger';
import { ledgerTransactionPath } from '@/lib/routes';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Code,
  Group,
  List,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { CheckCircle2, Download, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Tamper evidence (plan section 11): every posting is linked to the one
 * before it by a SHA-256 hash, and the head of that chain is published every
 * night. Anyone can download the chain and check it with a few lines of code.
 */
const LedgerChain = () => {
  const { t, language } = useLanguage();
  const { data, isLoading, isError } = useLedgerChain();
  const download = useDownloadChainCsv();
  const latest = data?.digests[0];

  return (
    <main className="container mx-auto max-w-3xl px-4 py-4">
      <Stack gap="md">
        <Group gap="sm">
          <BackButton />
          <Title order={1} size="h3">
            {t('ledger.chain.title')}
          </Title>
        </Group>
        <Text size="sm" c="dimmed">
          {t('ledger.chain.help')}
        </Text>

        {isLoading ? (
          <Text c="dimmed" className="py-8 text-center">
            {t('common.loading')}
          </Text>
        ) : isError || !data ? (
          <Text c="red" className="py-8 text-center">
            {t('common.loadingError')}
          </Text>
        ) : (
          <>
            {latest && !latest.chain_ok ? (
              <Alert
                color="red"
                icon={<ShieldAlert size={16} aria-hidden="true" />}
                title={t('ledger.chain.brokenTitle')}
              >
                {t('ledger.chain.brokenBody')}
              </Alert>
            ) : latest ? (
              <Alert color="green" icon={<CheckCircle2 size={16} aria-hidden="true" />}>
                {t('ledger.chain.okAt', { date: formatDate(latest.created_at, language) })}
              </Alert>
            ) : null}

            <Card withBorder>
              <Stack gap="xs">
                <Title order={2} size="h5">
                  {t('ledger.chain.head')}
                </Title>
                {data.head ? (
                  <>
                    <Text size="sm">
                      {t('ledger.chain.headBody', { count: data.head.position })}{' '}
                      <Anchor component={Link} to={ledgerTransactionPath(data.head.transaction)}>
                        #{data.head.seq}
                      </Anchor>
                    </Text>
                    <HashValue hash={data.head.hash} />
                  </>
                ) : (
                  <Text size="sm" c="dimmed">
                    {t('ledger.chain.empty')}
                  </Text>
                )}
                <Text size="xs" c="dimmed">
                  {data.digest_channel
                    ? t('ledger.chain.publishedTo')
                    : t('ledger.chain.noChannel')}
                </Text>
                <Group>
                  <Button
                    size="xs"
                    variant="default"
                    leftSection={<Download size={14} aria-hidden="true" />}
                    loading={download.isPending}
                    onClick={() => download.mutate()}
                    className="print-hide"
                  >
                    {t('ledger.chain.download')}
                  </Button>
                </Group>
              </Stack>
            </Card>

            <Card withBorder>
              <Title order={2} size="h5" mb="xs">
                {t('ledger.chain.howTitle')}
              </Title>
              <List type="ordered" size="sm" spacing={4}>
                <List.Item>{t('ledger.chain.how1')}</List.Item>
                <List.Item>{t('ledger.chain.how2')}</List.Item>
                <List.Item>{t('ledger.chain.how3')}</List.Item>
              </List>
              <Code block mt="sm">
                {`import csv, hashlib
prev = "0" * 64
for row in csv.DictReader(open("ledger-chain.csv", encoding="utf-8-sig")):
    assert row["prev_hash"] == prev
    assert hashlib.sha256((prev + row["canonical"]).encode()).hexdigest() == row["hash"]
    prev = row["hash"]
print("OK, head:", prev)`}
              </Code>
            </Card>

            <Card withBorder padding="sm">
              <Title order={2} size="h5" mb="xs">
                {t('ledger.chain.digests')}
              </Title>
              {data.digests.length === 0 ? (
                <Text size="sm" c="dimmed">
                  {t('ledger.chain.noDigests')}
                </Text>
              ) : (
                <Table.ScrollContainer minWidth={420}>
                  <Table fz="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{t('ledger.date')}</Table.Th>
                        <Table.Th ta="right">{t('ledger.chain.entries')}</Table.Th>
                        <Table.Th>{t('ledger.chain.hash')}</Table.Th>
                        <Table.Th>{t('ledger.chain.state')}</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {data.digests.map(digest => (
                        <Table.Tr key={digest.id}>
                          <Table.Td>{formatDate(digest.created_at, language)}</Table.Td>
                          <Table.Td className="text-right tabular-nums">{digest.position}</Table.Td>
                          <Table.Td>
                            <Code title={digest.head_hash}>{shortHash(digest.head_hash)}</Code>
                          </Table.Td>
                          <Table.Td>
                            <Badge color={digest.chain_ok ? 'green' : 'red'} variant="light">
                              {digest.chain_ok
                                ? t('ledger.chain.intact')
                                : t('ledger.chain.broken')}
                            </Badge>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Card>
          </>
        )}
      </Stack>
    </main>
  );
};

export default LedgerChain;
