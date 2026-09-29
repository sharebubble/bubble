import { expect, test } from '../../fixtures';
import { LedgerTransactionPage } from '../../pages/ledger/LedgerTransactionPage';
import { sessionApi } from '../../support/api';
import { env, hasAllCredentials } from '../../support/config';
import {
  findTransaction,
  type LedgerTransaction,
  ledgerContext,
  myAccount,
  postIntent,
  uniqueAmount,
} from '../../support/ledger';
import { namespaced } from '../../support/namespace';

/**
 * The trust layer (plan D9): any member disputes an entry; the entry never
 * changes, and its author undoes it with a linked reversal.
 */
test.describe('@regression @ledger disputes and reversals', () => {
  test.skip(!hasAllCredentials(), 'E2E_<ROLE>_USERNAME/PASSWORD not configured');
  test.skip(!env.ledger, 'Ledger entries are permanent: local stacks only, or E2E_LEDGER=1');

  test('a member disputes an entry and its author reverses it', async ({ browser, playwright }) => {
    const author = await sessionApi(playwright.request, 'renterA');
    const other = await sessionApi(playwright.request, 'renterB');
    const otherContext = await ledgerContext(browser, 'renterB');
    const authorContext = await ledgerContext(browser, 'renterA');

    try {
      // renterA books that they owe renterB for a pizza.
      const description = namespaced('Pizza I owe you for');
      const creditor = await myAccount(other.api);
      await postIntent(author.api, {
        intent: 'member_to_member',
        amount: uniqueAmount(8),
        description,
        counterparty: creditor.id,
      });
      const original: LedgerTransaction = await findTransaction(author.api, description);

      // renterB disagrees with it.
      const browserPage = await otherContext.newPage();
      const otherPage = new LedgerTransactionPage(browserPage, original.id);
      await otherPage.goto();
      await expect(otherPage.title).toHaveText(description);
      await otherPage.dispute('We shared that pizza, you owe me nothing.');
      await expect(otherPage.disputeReason('We shared that pizza')).toBeVisible();
      expect((await findTransaction(author.api, description)).open_disputes).toBe(1);

      // renterA takes it back with a reversal linked to the original.
      const authorPage = new LedgerTransactionPage(await authorContext.newPage(), original.id);
      await authorPage.goto();
      await authorPage.reverse('Booked by mistake, we shared it.');
      // The app opens the reversal, which links back to the original …
      await expect(authorPage.correctsOriginal).toBeVisible();
      // … and the original, unchanged, now points to its correction.
      await authorPage.goto();
      await expect(authorPage.title).toHaveText(description);
      await expect(authorPage.correctedBy).toBeVisible();

      const reversed = await author.api.getJson<LedgerTransaction>(
        `/api/ledger/transactions/${original.id}/`,
      );
      expect(reversed.reversed_by).toHaveLength(1);
    } finally {
      await Promise.all([otherContext.close(), authorContext.close()]);
      await Promise.all([author.dispose(), other.dispose()]);
    }
  });
});
