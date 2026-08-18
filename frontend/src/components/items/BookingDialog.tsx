import { Button, Group, Input, Modal, NumberInput, Text } from '@mantine/core';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCoinConfig } from '@/hooks/useAppConfig';
import { useCreateBooking } from '@/hooks/useBookings';
import { formatItemPrice, isCoinPriced, type PriceUnit } from '@/lib/coins';
import {
  getHoursPerRentalPeriod,
  getRentalPeriodSuffixKey,
  type RentalPeriod,
} from '@/lib/currency';
import { SalesTypeEnum } from '@/services/django';
import { addDays } from 'date-fns';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DateHourPicker } from './DateHourPicker';

// Guest-room style turnover: check-in at noon, check-out at noon the next
// day — matches the noon-to-noon default used by the rental calendar.
const NOON_HOUR = 12;

interface BookingDialogProps {
  itemUuid: string;
  itemName?: string;
  price?: string | null;
  priceCurrency?: string;
  priceUnit?: PriceUnit | string | null;
  salesType?: SalesTypeEnum;
  rentalPeriod?: RentalPeriod;
  rentalOpenEnd?: boolean;
  buttonSize?: 'default' | 'sm' | 'lg' | 'icon';
  buttonClassName?: string;
  triggerLabel?: string;
  disabled?: boolean;
  preselectedStartDate?: Date;
  preselectedEndDate?: Date;
  controlledOpen?: boolean;
  onControlledOpenChange?: (open: boolean) => void;
}

/** Format a Date as the YYYY-MM-DDTHH:mm string used internally. */
const formatDateLocal = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:00`;
};

/** Map the legacy shadcn button size prop to Mantine sizes. */
const mapButtonSize = (size: 'default' | 'sm' | 'lg' | 'icon'): 'md' | 'sm' | 'lg' => {
  switch (size) {
    case 'sm':
      return 'sm';
    case 'lg':
      return 'lg';
    default:
      return 'md';
  }
};

export const BookingDialog = ({
  itemUuid,
  itemName = '',
  price,
  priceCurrency,
  priceUnit,
  salesType,
  rentalPeriod,
  rentalOpenEnd = false,
  buttonSize = 'lg',
  buttonClassName = 'w-full md:w-auto',
  preselectedStartDate,
  preselectedEndDate,
  triggerLabel,
  disabled = false,
  controlledOpen,
  onControlledOpenChange,
}: BookingDialogProps) => {
  const { t } = useLanguage();
  const coin = useCoinConfig();
  const createBookingMutation = useCreateBooking();
  const navigate = useNavigate();
  const [internalOpen, setInternalOpen] = useState(false);
  const isRental = salesType === 'rent' || salesType === 'borrow';
  const isControlled =
    typeof controlledOpen !== 'undefined' && typeof onControlledOpenChange === 'function';
  const dialogOpen = isControlled ? controlledOpen! : internalOpen;
  const setDialogOpen = (val: boolean) => {
    if (isControlled) {
      onControlledOpenChange!(val);
    } else {
      setInternalOpen(val);
    }
  };
  const [offerPrice, setOfferPrice] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');

  // Calculate total price based on time period
  const calculateTotalPrice = (): string => {
    if (!isRental || !timeFrom || !timeTo || price == null) {
      return price || '';
    }

    const start = new Date(timeFrom);
    const end = new Date(timeTo);
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

    if (hours <= 0) {
      return price;
    }

    // The stored price is per rental_period (hour/day/week), so derive the
    // hourly rate before multiplying by the booked hours.
    const hourlyRate = parseFloat(price) / getHoursPerRentalPeriod(rentalPeriod);
    const total = hourlyRate * hours;
    return total.toFixed(2);
  };

  // Set default price when dialog opens or dates change
  useEffect(() => {
    if (dialogOpen) {
      const defaultPrice = calculateTotalPrice();
      setOfferPrice(defaultPrice);
    }
  }, [dialogOpen, isRental, price, timeFrom, timeTo, rentalPeriod]);

  // Pre-populate the dates when the dialog is opened directly (e.g. its own
  // "Book Now" button) rather than via a calendar selection, which already
  // supplies preselectedStartDate/EndDate.
  useEffect(() => {
    if (!dialogOpen || preselectedStartDate || timeFrom) return;

    if (rentalPeriod === 'd') {
      // Guest-room style default: check in at the next occurring noon,
      // check out 24h later at noon the following day.
      const now = new Date();
      const todayNoon = new Date(now);
      todayNoon.setHours(NOON_HOUR, 0, 0, 0);
      const checkIn = now < todayNoon ? todayNoon : addDays(todayNoon, 1);
      setTimeFrom(formatDateLocal(checkIn));
      if (!preselectedEndDate && !timeTo) {
        setTimeTo(formatDateLocal(addDays(checkIn, 1)));
      }
      return;
    }

    const now = new Date();
    now.setMinutes(0, 0, 0);
    setTimeFrom(formatDateLocal(now));
  }, [dialogOpen]);

  // Set preselected dates when they change
  useEffect(() => {
    if (preselectedStartDate) {
      setTimeFrom(formatDateLocal(preselectedStartDate));
    }
    if (preselectedEndDate) {
      setTimeTo(formatDateLocal(preselectedEndDate));
    }
  }, [preselectedStartDate, preselectedEndDate]);

  // Recalculate price when dates change
  useEffect(() => {
    if (isRental && timeFrom && timeTo) {
      const calculatedPrice = calculateTotalPrice();
      setOfferPrice(calculatedPrice);
    }
  }, [timeFrom, timeTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Allow empty / null values — backend accepts nulls for offer/time fields
    const booking = await createBookingMutation.mutateAsync({
      item: itemUuid,
      offer: offerPrice === '' ? null : offerPrice,
      time_from: timeFrom === '' ? null : timeFrom,
      time_to: timeTo === '' ? null : timeTo,
      status: 1, // Pending status
    });

    // Reset form and close dialog
    setOfferPrice('');
    setTimeFrom('');
    setTimeTo('');
    setDialogOpen(false);

    // If backend returned the created booking with a UUID, navigate to it
    if (booking && (booking as { id?: string }).id) {
      navigate(`/bookings`);
    }
  };

  return (
    <>
      <Button
        size={mapButtonSize(buttonSize)}
        className={`${buttonClassName} ${disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
        disabled={createBookingMutation.isPending || disabled}
        onClick={() => setDialogOpen(true)}
      >
        {triggerLabel ?? (isRental ? t('booking.bookNow') : t('itemDetail.buyNow'))}
      </Button>

      <Modal
        opened={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={isRental ? t('booking.bookNow') : t('itemDetail.buyNow')}
      >
        <form onSubmit={handleSubmit}>
          <Text size="sm" c="dimmed">
            {t('booking.createBookingDescription').replace('{itemName}', itemName)}
          </Text>

          <div className="grid gap-4 py-4">
            {/* Original Price Display */}
            <div className="space-y-1">
              {isRental && price != null ? (
                <Text>
                  <span className="font-medium">{t('booking.listedRentalPrice')}:</span>{' '}
                  {formatItemPrice(
                    { price, price_currency: priceCurrency, price_unit: priceUnit },
                    coin.shortName,
                  )}{' '}
                  {t(getRentalPeriodSuffixKey(rentalPeriod))}
                </Text>
              ) : price != null ? (
                <Text>
                  <span className="font-medium">{t('booking.listedPrice')}:</span>{' '}
                  {formatItemPrice(
                    { price, price_currency: priceCurrency, price_unit: priceUnit },
                    coin.shortName,
                  )}
                </Text>
              ) : null}
            </div>

            {/* Rental Duration */}
            {isRental && (
              <>
                <div className="space-y-2">
                  <Input.Label htmlFor="timeFrom">{t('booking.rentalStart')} *</Input.Label>
                  <DateHourPicker
                    id="timeFrom"
                    value={timeFrom}
                    onChange={setTimeFrom}
                    placeholder={t('booking.rentalStart')}
                  />
                </div>

                <div className="space-y-2">
                  <Input.Label htmlFor="timeTo">
                    {rentalOpenEnd ? t('booking.rentalEndOptional') : `${t('booking.rentalEnd')} *`}
                  </Input.Label>
                  {rentalOpenEnd && (
                    <Text size="xs" c="dimmed">
                      {t('booking.rentalEndOptionalNote')}
                    </Text>
                  )}
                  <DateHourPicker
                    id="timeTo"
                    value={timeTo}
                    onChange={setTimeTo}
                    min={timeFrom}
                    placeholder={t('booking.rentalEnd')}
                  />
                </div>
              </>
            )}

            {/* Calculated Total Price (editable) */}
            <div className="space-y-2">
              <Input.Label htmlFor="offer">
                {isRental ? t('booking.totalPrice') : t('booking.purchaseOffer')} *
              </Input.Label>
              {isRental &&
                timeFrom &&
                timeTo &&
                (() => {
                  const start = new Date(timeFrom);
                  const end = new Date(timeTo);
                  const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
                  if (hours > 0) {
                    return (
                      <Text size="sm" c="dimmed">
                        {hours} {hours === 1 ? t('time.hour') : t('time.hours')}
                      </Text>
                    );
                  }
                  return null;
                })()}
              <NumberInput
                id="offer"
                step={0.01}
                placeholder={t('booking.enterYourOffer')}
                value={offerPrice}
                onChange={value => setOfferPrice(value === '' ? '' : String(value))}
                suffix={isCoinPriced(priceUnit) ? ` ${coin.shortName}` : undefined}
              />
            </div>
          </div>

          <Group justify="flex-end" mt="md">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createBookingMutation.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={createBookingMutation.isPending}>
              {createBookingMutation.isPending
                ? t('common.submitting')
                : t('booking.submitRequest')}
            </Button>
          </Group>
        </form>
      </Modal>
    </>
  );
};
