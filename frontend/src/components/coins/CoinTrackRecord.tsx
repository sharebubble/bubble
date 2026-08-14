import { useLanguage } from '@/contexts/LanguageContext';
import { useCoinConfig } from '@/hooks/useAppConfig';
import { useItemCoinSummary, useItemCoinValuations } from '@/hooks/useCoins';
import { formatCoins } from '@/lib/coins';
import { getRentalPeriodSuffixKey } from '@/lib/currency';
import { Badge, Card, Group, Stack, Text } from '@mantine/core';
import { format, parseISO } from 'date-fns';
import { Coins, User } from 'lucide-react';

interface CoinTrackRecordProps {
  itemId: string;
}

const formatDate = (value: string | null | undefined) => {
  if (!value) return null;
  try {
    return format(parseISO(value), 'dd MMM yyyy');
  } catch {
    return null;
  }
};

/**
 * The public record of what an item has been worth to the community.
 *
 * Every settled free transaction its borrowers and buyers put a value on
 * shows up here — who got it, when, and how many coins they thought it was
 * worth — so the next person can see what is customary. Renders nothing until
 * the item has its first recorded value.
 */
export const CoinTrackRecord = ({ itemId }: CoinTrackRecordProps) => {
  const { t } = useLanguage();
  const coin = useCoinConfig();
  const { data: summary } = useItemCoinSummary(itemId);
  const { data: valuations } = useItemCoinValuations(itemId, Boolean(summary?.count));

  if (!summary?.count) return null;

  const entries = valuations?.results ?? [];

  return (
    <div className="space-y-3">
      <Group gap="xs" align="baseline" wrap="wrap">
        <Text
          component="div"
          size="sm"
          fw={600}
          c="dimmed"
          tt="uppercase"
          className="tracking-wide"
        >
          <Group gap={6} align="center">
            <Coins size={16} />
            <span>{t('coins.trackRecordTitle').replace('{coin}', coin.name)}</span>
          </Group>
        </Text>
        <Badge variant="light" color="teal">
          {t('coins.trackRecordSummary')
            .replace('{count}', String(summary.count))
            .replace('{total}', formatCoins(summary.total))
            .replace('{coin}', coin.shortName)}
        </Badge>
        {summary.average && (
          <Text size="xs" c="dimmed">
            {t('coins.trackRecordAverage')
              .replace('{average}', formatCoins(summary.average))
              .replace('{coin}', coin.shortName)}
          </Text>
        )}
      </Group>

      <Stack gap="xs">
        {entries.map(entry => {
          const from = formatDate(entry.time_from);
          const to = formatDate(entry.time_to);
          const period = from ? (to ? `${from} → ${to}` : from) : formatDate(entry.created_at);

          return (
            <Card key={entry.id} withBorder padding="xs">
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <div className="min-w-0">
                  <Text size="sm" fw={500} truncate className="flex items-center gap-1">
                    <User size={12} className="shrink-0" />
                    {entry.user.name || entry.user.username}
                  </Text>
                  {period && (
                    <Text size="xs" c="dimmed">
                      {period}
                    </Text>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <Text size="sm" fw={700}>
                    {formatCoins(entry.amount)} {coin.shortName}
                  </Text>
                  {entry.rate && (
                    <Text size="xs" c="dimmed">
                      {formatCoins(entry.rate)} {coin.shortName}
                      {t(getRentalPeriodSuffixKey(entry.rental_period))}
                    </Text>
                  )}
                </div>
              </Group>
            </Card>
          );
        })}
      </Stack>
    </div>
  );
};
