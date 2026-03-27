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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {t('bookings.counterOffer')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('bookings.counterOfferDialogTitle')}</DialogTitle>
            <DialogDescription>{t('bookings.counterOfferDialogDescription')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="counterOffer">{t('bookings.counterOffer')}</Label>
              <Input
                id="counterOffer"
                type="number"
                step="0.01"
                value={value ?? ''}
                onChange={e => setValue(e.target.value)}
                placeholder={t('booking.enterYourOffer')}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={updateBooking.isPending}>
              {t('bookings.counterOfferSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default BookingCounterOfferDialog;
