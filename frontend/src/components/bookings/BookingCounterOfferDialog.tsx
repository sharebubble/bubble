import { Button, Group, Modal, NumberInput, Stack, Text } from '@mantine/core';
import { useLanguage } from '@/contexts/LanguageContext';
import { useUpdateBooking } from '@/hooks/useBookings';
import { useEffect, useState } from 'react';

interface Props {
  booking: any;
}

const BookingCounterOfferDialog = ({ booking }: Props) => {
  const { t } = useLanguage();
  const updateBooking = useUpdateBooking();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string>(booking?.counter_offer ?? '');

  useEffect(() => {
    if (open) {
      setValue(booking?.counter_offer ?? '');
    }
  }, [open, booking]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateBooking.mutateAsync({
        id: booking.id,
        data: { counter_offer: value === '' ? null : value },
      });
      setOpen(false);
    } catch (err) {
      // handled by hook
    }
  };

  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        {t('requests.counterOffer')}
      </Button>
      <Modal
        opened={open}
        onClose={() => setOpen(false)}
        title={t('requests.counterOfferDialogTitle')}
      >
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {t('requests.counterOfferDialogDescription')}
            </Text>

            <NumberInput
              label={t('requests.counterOffer')}
              step={0.01}
              decimalScale={2}
              value={value ?? ''}
              onChange={v => setValue(v === '' ? '' : String(v))}
              placeholder={t('booking.enterYourOffer')}
            />

            <Group justify="flex-end" mt="md">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={updateBooking.isPending}>
                {t('requests.counterOfferSubmit')}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
};

export default BookingCounterOfferDialog;
