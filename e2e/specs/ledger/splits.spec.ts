import { expect, test } from '../../fixtures';
import { LedgerCostSharePage } from '../../pages/ledger/LedgerCostSharePage';
import { LedgerPage } from '../../pages/ledger/LedgerPage';
import { sessionApi } from '../../support/api';
import { env, hasAllCredentials } from '../../support/config';
import { effectOn, ledgerContext, type LedgerTransaction, myAccount } from '../../support/ledger';
import { namespaced } from '../../support/namespace';

interface CostShare {
  id: string;
  state: string;
  posted_transaction: string | null;
}

/**
 * Shared costs (plan section 7a): the payer splits a bill, every participant
 * accepts or objects, and one shared-expense entry is booked once all have
 * answered.
 */
test.describe('@regression @ledger shared costs', () => {
  test.skip(!hasAllCredentials(), 'E2E_<ROLE>_USERNAME/PASSWORD not configured');
  test.skip(!env.ledger, 'Ledger entries are permanent: local stacks only, or E2E_LEDGER=1');

  test('a bill split three ways is booked once everyone accepted', async ({
    browser,
    playwright,
  }) => {
    const payer = await sessionApi(playwright.request, 'renterA');
    const guest = await sessionApi(playwright.request, 'renterB');
    const owner = await sessionApi(playwright.request, 'owner');
    const payerContext = await ledgerContext(browser, 'renterA');
    const guestContext = await ledgerContext(browser, 'renterB');

    try {
      const [guestAccount, ownerAccount] = await Promise.all([
        myAccount(guest.api),
        myAccount(owner.api),
      ]);

      // renterA paid 30 € for dinner and splits it with renterB and the owner.
      const payerPage = await payerContext.newPage();
      const ledger = new LedgerPage(payerPage);
      await ledger.goto();
      const dialog = await ledger.openSplit();
      await dialog.fill({
        description: namespaced('Dinner after the repair café'),
        total: '30.00',
        participants: [guestAccount.name, ownerAccount.name],
      });
      await dialog.send();
      await payerPage.waitForURL(/\/ledger\/splits\/[0-9a-f-]+$/);
      const splitId = payerPage.url().split('/').pop()!;

      // renterB accepts in the app, the owner through the API.
      const guestPage = new LedgerCostSharePage(await guestContext.newPage(), splitId);
      await guestPage.goto();
      await guestPage.accept();
      await expect(guestPage.acceptButton).toBeHidden();
      await owner.api.postJson(`/api/ledger/splits/${splitId}/accept/`);

      // Everyone answered: one entry, each participant charged their 10 €.
      const split = await payer.api.getJson<CostShare>(`/api/ledger/splits/${splitId}/`);
      expect(split.state).toBe('posted');
      const posted = await payer.api.getJson<LedgerTransaction>(
        `/api/ledger/transactions/${split.posted_transaction}/`,
      );
      expect(posted.kind).toBe('shared_expense');
      expect(effectOn(posted, guestAccount.id)).toBe(-10);
      expect(effectOn(posted, ownerAccount.id)).toBe(-10);
      expect(effectOn(posted, (await myAccount(payer.api)).id)).toBe(20);

      await payerPage.reload();
      await expect(new LedgerCostSharePage(payerPage, splitId).state('Booked')).toBeVisible();
    } finally {
      await Promise.all([payerContext.close(), guestContext.close()]);
      await Promise.all([payer.dispose(), guest.dispose(), owner.dispose()]);
    }
  });
});
