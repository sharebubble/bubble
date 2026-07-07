import { expect, test } from '../../fixtures';
import { authedApi, BookingStatus, type Item } from '../../support/api';
import { hasAllCredentials } from '../../support/config';
import { namespaced } from '../../support/namespace';

const HOUR = 60 * 60 * 1000;

/** ISO window `offsetHours` from now, `durationHours` long. */
function window(offsetHours: number, durationHours = 1) {
  const from = new Date(Date.now() + offsetHours * HOUR);
  const to = new Date(from.getTime() + durationHours * HOUR);
  return { time_from: from.toISOString(), time_to: to.toISOString() };
}

/**
 * Multi-actor booking flows against the live API. Exercises the full negotiation
 * lifecycle across three real users and the PostgreSQL overlap exclusion
 * constraint. Data is namespaced and cleaned up per test (purge_e2e is the
 * backstop). Requires the user pool; skipped when unconfigured.
 */
test.describe('@regression multi-user booking', () => {
  test.skip(!hasAllCredentials(), 'E2E_<ROLE>_USERNAME/PASSWORD not configured');

  test('negotiation: offer → counter-offer → owner confirms → renter completes', async ({
    playwright,
  }) => {
    const owner = await authedApi(playwright.request, 'owner');
    const renter = await authedApi(playwright.request, 'renterA');
    let item: Item | undefined;

    try {
      item = await owner.api.createItem({
        name: namespaced('Cordless Drill'),
        price: '10.00',
        rental_self_service: false,
      });

      // Renter offers below list price → stays PENDING for the owner to review.
      const booking = await renter.api.createBooking({
        item: item.id,
        ...window(24),
        offer: '8.00',
      });
      expect(booking.status).toBe(BookingStatus.PENDING);

      // Owner counter-offers (allowed only while PENDING, only by non-booker).
      const countered = await owner.api.updateBooking(booking.id, { counter_offer: '9.00' });
      expect(Number(countered.counter_offer)).toBe(9);
      expect(countered.status).toBe(BookingStatus.PENDING);

      // Owner confirms; renter later marks the rental completed.
      const confirmed = await owner.api.updateBooking(booking.id, {
        status: BookingStatus.CONFIRMED,
      });
      expect(confirmed.status).toBe(BookingStatus.CONFIRMED);

      const completed = await renter.api.updateBooking(booking.id, {
        status: BookingStatus.COMPLETED,
      });
      expect(completed.status).toBe(BookingStatus.COMPLETED);
    } finally {
      if (item) await owner.api.deleteItem(item.id).catch(() => {});
      await Promise.all([owner.dispose(), renter.dispose()]);
    }
  });

  test('overlap: a confirmed booking blocks an overlapping one', async ({ playwright }) => {
    const owner = await authedApi(playwright.request, 'owner');
    const renterA = await authedApi(playwright.request, 'renterA');
    const renterB = await authedApi(playwright.request, 'renterB');
    let item: Item | undefined;

    try {
      // Self-service at list price → offers matching the price auto-confirm.
      item = await owner.api.createItem({
        name: namespaced('Party Tent'),
        price: '10.00',
        rental_self_service: true,
      });

      const first = await renterA.api.createBooking({
        item: item.id,
        ...window(48),
        offer: '10.00',
      });
      expect(first.status).toBe(BookingStatus.CONFIRMED);

      // renterB requests an overlapping window at list price → auto-confirm hits
      // the exclusion constraint and the API returns a clean 400 (not a 500).
      const res = await renterB.api.tryCreateBooking({
        item: item.id,
        ...window(48.5), // starts 30 min into the first, confirmed window
        offer: '10.00',
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/already rented|different time/i);
    } finally {
      if (item) await owner.api.deleteItem(item.id).catch(() => {});
      await Promise.all([owner.dispose(), renterA.dispose(), renterB.dispose()]);
    }
  });
});
