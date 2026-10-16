import { expect, test } from '../../fixtures';
import { LedgerAccountPage } from '../../pages/ledger/LedgerAccountPage';
import { sessionApi, BookingStatus, type Item } from '../../support/api';
import { env, hasAllCredentials } from '../../support/config';
import {
  effectOn,
  findTransaction,
  findTransactions,
  ledgerContext,
  myAccount,
} from '../../support/ledger';
import { namespaced } from '../../support/namespace';

const HOUR = 60 * 60 * 1000;

function window(offsetHours: number, durationHours = 1) {
  const from = new Date(Date.now() + offsetHours * HOUR);
  const to = new Date(from.getTime() + durationHours * HOUR);
  return { time_from: from.toISOString(), time_to: to.toISOString() };
}

/**
 * Bookings charge the ledger (plan section 6): a rental when it is returned,
 * a sale when the buyer confirms the hand-over. Only items with payments
 * switched on are charged. The bookings are driven through the API; the
 * result is checked in the ledger UI.
 */
test.describe('@regression @ledger booking charges', () => {
  test.skip(!hasAllCredentials(), 'E2E_<ROLE>_USERNAME/PASSWORD not configured');
  test.skip(!env.ledger, 'Ledger entries are permanent: local stacks only, or E2E_LEDGER=1');

  test('a returned rental charges the renter and credits the owner', async ({
    browser,
    playwright,
  }) => {
    const owner = await sessionApi(playwright.request, 'owner');
    const renter = await sessionApi(playwright.request, 'renterA');
    const context = await ledgerContext(browser, 'renterA');
    let item: Item | undefined;

    try {
      item = await owner.api.createItem({
        name: namespaced('Rented ladder'),
        price: '10.00',
        rental_self_service: true,
        payment_enabled: true,
      });
      const booking = await renter.api.createBooking({
        item: item.id,
        ...window(2),
        offer: '10.00',
      });
      expect(booking.status).toBe(BookingStatus.CONFIRMED);

      // Picked up, then returned: returning completes and charges the rental.
      await renter.api.postJson(`/api/bookings/${booking.id}/confirm_received/`);
      await owner.api.postJson(`/api/bookings/${booking.id}/confirm_returned/`);

      const charge = await findTransaction(renter.api, item.name);
      expect(charge.kind).toBe('booking_charge');
      expect(effectOn(charge, (await myAccount(renter.api)).id)).toBe(-10);
      expect(effectOn(charge, (await myAccount(owner.api)).id)).toBe(10);

      const page = await context.newPage();
      const account = new LedgerAccountPage(page);
      await account.goto();
      await expect(account.statementLine(item.name)).toBeVisible();
    } finally {
      if (item) await owner.api.deleteItem(item.id).catch(() => {});
      await context.close();
      await Promise.all([owner.dispose(), renter.dispose()]);
    }
  });

  test('a sale is charged once the buyer confirms the hand-over', async ({
    browser,
    playwright,
  }) => {
    const seller = await sessionApi(playwright.request, 'owner');
    const buyer = await sessionApi(playwright.request, 'renterB');
    const context = await ledgerContext(browser, 'renterB');
    let item: Item | undefined;

    try {
      item = await seller.api.createItem({
        name: namespaced('Used bicycle'),
        sales_type: 'sell',
        price: '25.00',
        payment_enabled: true,
      });
      const booking = await buyer.api.createBooking({
        item: item.id,
        ...window(3),
        offer: '25.00',
      });

      // The seller accepts: the item changes hands, nothing is charged yet.
      await seller.api.updateBooking(booking.id, { status: BookingStatus.CONFIRMED });
      expect(await findTransactions(buyer.api, item.name)).toEqual([]);

      // The buyer confirms they received it: now the price is charged.
      await buyer.api.postJson(`/api/bookings/${booking.id}/confirm_received/`);
      const charge = await findTransaction(buyer.api, item.name);
      expect(charge.kind).toBe('booking_charge');
      expect(effectOn(charge, (await myAccount(buyer.api)).id)).toBe(-25);
      expect(effectOn(charge, (await myAccount(seller.api)).id)).toBe(25);

      const page = await context.newPage();
      const account = new LedgerAccountPage(page);
      await account.goto();
      await expect(account.statementLine(item.name)).toBeVisible();
    } finally {
      // The buyer owns the item now.
      if (item) await buyer.api.deleteItem(item.id).catch(() => {});
      await context.close();
      await Promise.all([seller.dispose(), buyer.dispose()]);
    }
  });
});
