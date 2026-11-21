import { useLanguage } from '@/contexts/LanguageContext';
import { getQuickRentErrorMessage, useQuickRent } from '@/hooks/useQuickRent';
import type { QuickRent as QuickRentOutcome } from '@/services/django';
import { Alert, Button, Card, Loader, Text, ThemeIcon, Title } from '@mantine/core';
import { format } from 'date-fns';
import { CircleAlert, CircleCheck, Clock, Undo2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

type QuickRentState = { quickRentOutcome?: QuickRentOutcome } | null;

const formatDateTime = (value?: string | null) =>
  value ? format(new Date(value), 'dd.MM.yyyy HH:mm') : '';

/**
 * Landing page of an item's QR code. Opening it rents the item to the signed-in
 * user right away; opening it again returns the item. If someone else has the
 * item, it shows who.
 */
const QuickRent = () => {
  const { itemUuid } = useParams<{ itemUuid: string }>();
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const quickRent = useQuickRent();
  const requested = useRef(false);

  // The outcome is kept in the history entry, so reloading the confirmation
  // page shows it again instead of scanning (and toggling) a second time.
  const storedOutcome = (location.state as QuickRentState)?.quickRentOutcome;
  const outcome = storedOutcome ?? quickRent.data;

  useEffect(() => {
    if (!itemUuid || storedOutcome || requested.current) return;
    requested.current = true;
    quickRent.mutate(itemUuid, {
      onSuccess: data =>
        navigate(location.pathname, { replace: true, state: { quickRentOutcome: data } }),
    });
  }, [itemUuid, storedOutcome, quickRent, navigate, location.pathname]);

  const itemLink = `/item/${itemUuid}`;

  const content = (() => {
    if (quickRent.isError) {
      return (
        <>
          <ThemeIcon color="red" size={72} radius="xl" variant="light">
            <CircleAlert size={40} />
          </ThemeIcon>
          <Title order={2}>{t('quickRent.errorTitle')}</Title>
          <Text c="dimmed">
            {getQuickRentErrorMessage(quickRent.error) || t('quickRent.errorDescription')}
          </Text>
        </>
      );
    }

    if (!outcome) {
      return (
        <>
          <Loader size="lg" />
          <Text c="dimmed">{t('quickRent.processing')}</Text>
        </>
      );
    }

    const item = outcome.item_name;
    switch (outcome.result) {
      case 'rented':
        return (
          <>
            <ThemeIcon color="green" size={72} radius="xl" variant="light">
              <CircleCheck size={40} />
            </ThemeIcon>
            <Title order={2}>{t('quickRent.rentedTitle', { item })}</Title>
            <Text c="dimmed">
              {t('quickRent.rentedDescription', { time: formatDateTime(outcome.time_from) })}
            </Text>
            {outcome.next_booking_at && (
              <Alert color="yellow" icon={<Clock size={16} />} className="text-left">
                {t('quickRent.nextBooking', { time: formatDateTime(outcome.next_booking_at) })}
              </Alert>
            )}
          </>
        );
      case 'returned':
        return (
          <>
            <ThemeIcon color="blue" size={72} radius="xl" variant="light">
              <Undo2 size={40} />
            </ThemeIcon>
            <Title order={2}>{t('quickRent.returnedTitle', { item })}</Title>
            <Text c="dimmed">
              {t('quickRent.returnedDescription', { time: formatDateTime(outcome.time_to) })}
            </Text>
          </>
        );
      default:
        return (
          <>
            <ThemeIcon color="orange" size={72} radius="xl" variant="light">
              <CircleAlert size={40} />
            </ThemeIcon>
            <Title order={2}>{t('quickRent.unavailableTitle', { item })}</Title>
            <Text c="dimmed">
              {t('quickRent.unavailableDescription', {
                renter: outcome.renter_name || t('quickRent.someoneElse'),
                time: formatDateTime(outcome.time_from),
              })}
            </Text>
          </>
        );
    }
  })();

  return (
    <div className="container mx-auto max-w-md px-4 py-12">
      <Card withBorder padding="xl" shadow="md">
        <div className="flex flex-col items-center gap-4 text-center">
          {content}
          {(outcome || quickRent.isError) && (
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              <Button component={Link} to={itemLink} variant="light">
                {t('quickRent.viewItem')}
              </Button>
              {outcome && outcome.result !== 'unavailable' && (
                <Button component={Link} to={`/bookings/${outcome.booking_id}`} variant="default">
                  {t('quickRent.viewBooking')}
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default QuickRent;
