import { Button, Group, Modal, NumberInput, Stack, Text, TextInput } from '@mantine/core';
import { useLanguage } from '@/contexts/LanguageContext';
import { useUpdateBooking } from '@/hooks/useBookings';
import { useEffect, useState } from 'react';

interface Props {
  booking: any; // Booking type from API
}

// Convert ISO datetime string to datetime-local input format (YYYY-MM-DDTHH:mm)
const toDateTimeLocalString = (isoString?: string | null): string => {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  } catch {
    return '';
  }
};

// Convert datetime-local input value to ISO string for backend
const toISOString = (dateTimeLocal: string): string | null => {
  if (!dateTimeLocal) return null;
  try {
    return new Date(dateTimeLocal).toISOString();
  } catch {
    return null;
  }
};

const BookingEditDialog = ({ booking }: Props) => {
  const { t } = useLanguage();
  const updateBooking = useUpdateBooking();
  const [open, setOpen] = useState(false);

  const isRental = booking?.item_details?.sales_type === 'rent';
  const [timeFrom, setTimeFrom] = useState<string>('');
  const [timeTo, setTimeTo] = useState<string>('');
  const [offer, setOffer] = useState<string>(booking?.offer ?? '');

  // Store original values to detect changes
  const [originalValues, setOriginalValues] = useState({
    timeFrom: '',
    timeTo: '',
    offer: booking?.offer ?? '',
  });

  useEffect(() => {
    if (open) {
      // Reset to current booking values when dialog opens
      const currentTimeFrom = toDateTimeLocalString(booking?.time_from);
      const currentTimeTo = toDateTimeLocalString(booking?.time_to);
      const currentOffer = booking?.offer ?? '';

      setTimeFrom(currentTimeFrom);
      setTimeTo(currentTimeTo);
      setOffer(currentOffer);

      // Store original values
      setOriginalValues({
        timeFrom: currentTimeFrom,
        timeTo: currentTimeTo,
        offer: currentOffer,
      });
    }
  }, [open, booking]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Build update data object with only changed fields
    const updateData: any = {};

    if (timeFrom !== originalValues.timeFrom) {
      updateData.time_from = toISOString(timeFrom);
    }

    if (timeTo !== originalValues.timeTo) {
      updateData.time_to = toISOString(timeTo);
    }

    if (offer !== originalValues.offer) {
      updateData.offer = offer === '' ? null : offer;
    }

    // Only send request if there are changes
    if (Object.keys(updateData).length === 0) {
      setOpen(false);
      return;
    }

    try {
      await updateBooking.mutateAsync({
        id: booking.id,
        data: updateData,
      });
      setOpen(false);
    } catch (err) {
      // handled by hook
    }
  };

  const handleCancel = () => {
    // Reset to original values when canceling
    setTimeFrom(originalValues.timeFrom);
    setTimeTo(originalValues.timeTo);
    setOffer(originalValues.offer);
    setOpen(false);
  };

  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        {t('requests.editBooking')}
      </Button>
      <Modal opened={open} onClose={handleCancel} title={t('requests.editBooking')}>
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {t('requests.editBookingDescription')}
            </Text>

            {isRental && (
              <>
                <TextInput
                  label={t('booking.rentalStart')}
                  type="datetime-local"
                  value={timeFrom}
                  onChange={e => setTimeFrom(e.currentTarget.value)}
                />
                <TextInput
                  label={t('booking.rentalEnd')}
                  type="datetime-local"
                  value={timeTo}
                  onChange={e => setTimeTo(e.currentTarget.value)}
                />
              </>
            )}

            <NumberInput
              label={t('booking.enterYourOffer')}
              step={0.01}
              decimalScale={2}
              value={offer ?? ''}
              onChange={v => setOffer(v === '' ? '' : String(v))}
            />

            <Group justify="flex-end" mt="md">
              <Button type="button" variant="outline" onClick={handleCancel}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={updateBooking.isPending}>
                {t('requests.update')}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
};

export default BookingEditDialog;
