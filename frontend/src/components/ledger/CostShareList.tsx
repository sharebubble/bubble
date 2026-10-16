import { useLanguage } from '@/contexts/LanguageContext';
import { formatMoney } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import { COST_SHARE_STATE_COLORS, myShare } from '@/lib/ledger';
import { ledgerCostSharePath } from '@/lib/routes';
import type { LedgerCostShare, LedgerMyAccount } from '@/services/django';
import { Badge, Card, Divider, Group, Text, UnstyledButton } from '@mantine/core';
import { Fragment } from 'react';
import { useNavigate } from 'react-router-dom';

/** Splits as a compact list; each row opens the split. */
export const CostShareList = ({
  costShares,
  me,
}: {
  costShares: LedgerCostShare[];
  me?: LedgerMyAccount;
}) => {
  const { t, language } = useLanguage();
  const navigate = useNavigate();

  return (
    <Card withBorder padding={0}>
      {costShares.map((costShare, index) => {
        const share = myShare(costShare, me);
        const waiting = costShare.state === 'open' && costShare.my_response === 'pending';
        return (
          <Fragment key={costShare.id}>
            {index > 0 && <Divider />}
            <UnstyledButton
              className="block w-full px-4 py-3"
              onClick={() => navigate(ledgerCostSharePath(costShare.id))}
            >
              <Group justify="space-between" wrap="nowrap">
                <div className="min-w-0">
                  <Text size="sm" fw={500} truncate>
                    {costShare.description}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {t('ledger.split.paidBy', { name: costShare.payer.name })} ·{' '}
                    {formatDate(costShare.occurred_on, language)}
                    {share !== undefined &&
                      ` · ${t('ledger.split.yourShare', {
                        amount: formatMoney(share, costShare.currency, language),
                      })}`}
                  </Text>
                </div>
                <div className="shrink-0 text-right">
                  <Text size="sm" fw={600}>
                    {formatMoney(costShare.total, costShare.currency, language)}
                  </Text>
                  {waiting ? (
                    <Badge size="sm" color="orange">
                      {t('ledger.split.answerNeeded')}
                    </Badge>
                  ) : (
                    <Badge
                      size="sm"
                      variant="light"
                      color={COST_SHARE_STATE_COLORS[costShare.state]}
                    >
                      {t(`ledger.split.state.${costShare.state}`)}
                    </Badge>
                  )}
                </div>
              </Group>
            </UnstyledButton>
          </Fragment>
        );
      })}
    </Card>
  );
};
