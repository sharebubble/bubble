import { type Language, useLanguage } from '@/contexts/LanguageContext';
import { useRejectFulfillment } from '@/hooks/useBookings';
import { formatMoney } from '@/lib/currency';
import { ledgerTransactionPath } from '@/lib/routes';
import type { Booking } from '@/services/django';
import { Alert, Anchor, Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Info, Receipt } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

const agreedPrice = (booking: Booking, language: Language) =>
  booking.agreed_price
    ? formatMoney(booking.agreed_price, booking.agreed_price_currency ?? 'EUR', language)
    : null;

/**
 * What happens next in an accepted sale, told to whoever is looking: the
 * buyer confirms receipt (and is charged) or reports a problem; the seller
 * waits and can no longer cancel.
 */
export const AcceptedSaleNotice = ({
  booking,
  isBuyer,
}: {
  booking: Booking;
  isBuyer: boolean;
}) => {
  const { t, language } = useLanguage();
  const amount = agreedPrice(booking, language);
  const charged = booking.ledger_state === 'pending' && amount;
  const buyerName = booking.user?.name || booking.user?.username || '';

  return (
    <Alert color="blue" icon={<Info size={16} aria-hidden="true" />} mt="md">
      <Stack gap={4}>
        <Text size="sm">
          {isBuyer
            ? t('booking.saleAcceptedBuyer')
            : t('booking.saleAcceptedSeller', { name: buyerName })}
        </Text>
        {charged && (
          <Text size="sm" fw={500}>
            {isBuyer
              ? t('booking.saleChargeOnReceipt', { amount })
              : t('booking.saleCreditOnReceipt', { amount })}
          </Text>
        )}
        {isBuyer && (
          <Text size="sm" c="dimmed">
            {t('booking.saleProblemHint')}
          </Text>
        )}
      </Stack>
    </Alert>
  );
};

/** The agreed price and, once posted, a link to the ledger transaction. */
export const BookingChargeInfo = ({ booking }: { booking: Booking }) => {
  const { t, language } = useLanguage();
  const amount = agreedPrice(booking, language);
  if (!amount) return null;

  return (
    <div>
      <Text size="xs" fw={500} className="mb-1">
        {booking.ledger_state === 'posted' ? t('booking.charged') : t('booking.agreedPrice')}
      </Text>
      <Text size="lg" fw={700}>
        {amount}
      </Text>
      {booking.ledger_transaction && (
        <Anchor
          component={Link}
          to={ledgerTransactionPath(booking.ledger_transaction)}
          size="xs"
          className="inline-flex items-center gap-1"
        >
          <Receipt size={12} aria-hidden="true" />
          {t('booking.viewInLedger')}
        </Anchor>
      )}
    </div>
  );
};

/** Buyer: the item was not handed over or is not as described. */
export const ReportProblemButton = ({ booking }: { booking: Booking }) => {
  const { t } = useLanguage();
  const [opened, { open, close }] = useDisclosure(false);
  const [reason, setReason] = useState('');
  const reject = useRejectFulfillment();

  const submit = async () => {
    await reject.mutateAsync({ id: booking.id, reason: reason.trim() });
    close();
    setReason('');
  };

  return (
    <>
      <Button variant="outline" color="red" onClick={open}>
        {t('requests.reportProblem')}
      </Button>
      <Modal opened={opened} onClose={close} title={t('requests.reportProblemTitle')}>
        <Stack gap="sm">
          <Text size="sm">{t('requests.reportProblemBody')}</Text>
          <Textarea
            label={t('requests.reportProblemReason')}
            placeholder={t('requests.reportProblemPlaceholder')}
            value={reason}
            onChange={event => setReason(event.currentTarget.value)}
            maxLength={200}
            autosize
            minRows={2}
            required
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button
              color="red"
              onClick={() => void submit().catch(() => undefined)}
              loading={reject.isPending}
              disabled={!reason.trim()}
            >
              {t('requests.reportProblemConfirm')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};
