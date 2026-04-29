import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/contexts/LanguageContext';
import { useCreateBooking } from '@/hooks/useBookings';
import { formatPrice } from '@/lib/currency';
import { SalesTypeEnum } from '@/services/django';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface BookingDialogProps {
  itemUuid: string;
  itemName?: string;
  price?: string | null;
  priceCurrency?: string;
  salesType?: SalesTypeEnum;
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

/** Format a Date as the YYYY-MM-DDTHH:mm string expected by datetime-local inputs.
 *  Uses local time (not UTC) so the value matches what the user sees. */
const formatDateLocal = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

export const BookingDialog = ({
  itemUuid,
  itemName = '',
  price,
  priceCurrency,
  salesType,
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

    const hourlyRate = parseFloat(price);
    const total = hourlyRate * hours;
    return total.toFixed(2);
  };

  // Set default price when dialog opens or dates change
  useEffect(() => {
    if (dialogOpen) {
      const defaultPrice = calculateTotalPrice();
      setOfferPrice(defaultPrice);
    }
  }, [dialogOpen, isRental, price, timeFrom, timeTo]);

  // Pre-populate timeFrom with current time (rounded down to the started hour)
  // when no preselectedStartDate is provided and the dialog opens.
  useEffect(() => {
    if (dialogOpen && !preselectedStartDate && !timeFrom) {
      const now = new Date();
      now.setMinutes(0, 0, 0);
      setTimeFrom(formatDateLocal(now));
    }
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
    if (booking && (booking as any).id) {
      navigate(`/bookings`);
    }
  };
  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button
          size={buttonSize}
          className={`${buttonClassName} ${disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
          disabled={createBookingMutation.isPending || disabled}
        >
          {triggerLabel ?? (isRental ? t('booking.bookNow') : t('itemDetail.buyNow'))}
        </Button>
      </DialogTrigger>

      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isRental ? t('booking.bookNow') : t('itemDetail.buyNow')}</DialogTitle>
            <DialogDescription>
              {t('booking.createBookingDescription').replace('{itemName}', itemName)}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Original Price Display */}
            <div className="space-y-1">
              {isRental && price != null ? (
                <p className="text-base">
                  <span className="font-medium">{t('booking.listedRentalPrice')}:</span>{' '}
                  {formatPrice(price, priceCurrency)} {t('time.perHour')}
                </p>
              ) : price != null ? (
                <p className="text-base">
                  <span className="font-medium">{t('booking.listedPrice')}:</span>{' '}
                  {formatPrice(price, priceCurrency)}
                </p>
              ) : null}
            </div>

            {/* Rental Duration - only show if item has rental price */}
            {isRental && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="timeFrom">
                    {t('booking.rentalStart')} *
                    <span className="ml-1 text-xs text-muted-foreground">(24h)</span>
                  </Label>
                  <Input
                    id="timeFrom"
                    type="datetime-local"
                    step="3600"
                    value={timeFrom}
                    onChange={e => setTimeFrom(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="timeTo">
                    {rentalOpenEnd ? t('booking.rentalEndOptional') : `${t('booking.rentalEnd')} *`}
                    <span className="ml-1 text-xs text-muted-foreground">(24h)</span>
                  </Label>
                  {rentalOpenEnd && (
                    <p className="text-xs text-muted-foreground">
                      {t('booking.rentalEndOptionalNote')}
                    </p>
                  )}
                  <Input
                    id="timeTo"
                    type="datetime-local"
                    step="3600"
                    value={timeTo}
                    onChange={e => setTimeTo(e.target.value)}
                    min={timeFrom}
                  />
                </div>
              </>
            )}

            {/* Calculated Total Price (editable) */}
            <div className="space-y-2">
              <Label htmlFor="offer">
                {isRental ? t('booking.totalPrice') : t('booking.purchaseOffer')} *
              </Label>
              {isRental &&
                timeFrom &&
                timeTo &&
                (() => {
                  const start = new Date(timeFrom);
                  const end = new Date(timeTo);
                  const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
                  if (hours > 0) {
                    return (
                      <p className="text-sm text-muted-foreground">
                        {hours} {hours === 1 ? t('time.hour') : t('time.hours')}
                      </p>
                    );
                  }
                  return null;
                })()}
              <Input
                id="offer"
                type="number"
                step="0.01"
                placeholder={t('booking.enterYourOffer')}
                value={offerPrice}
                onChange={e => setOfferPrice(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
