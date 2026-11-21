import { expect, test } from '../../fixtures';
import { LedgerBankPage } from '../../pages/ledger/LedgerBankPage';
import { sessionApi } from '../../support/api';
import { env, hasAllCredentials } from '../../support/config';
import {
  camtStatement,
  effectOn,
  findTransactions,
  ledgerContext,
  myAccount,
  uniqueAmount,
} from '../../support/ledger';
import { NAMESPACE, namespaced } from '../../support/namespace';

/**
 * Bank import (plan section 12): the treasurer uploads a CAMT.053 statement;
 * a transfer carrying a member's payment reference is booked to that member
 * in one click, an unknown one is parked and assigned later.
 */
test.describe('@regression @ledger bank import', () => {
  test.skip(!hasAllCredentials(), 'E2E_<ROLE>_USERNAME/PASSWORD not configured');
  test.skip(!env.ledger, 'Ledger entries are permanent: local stacks only, or E2E_LEDGER=1');

  test('a statement is imported, matched by reference, parked and assigned', async ({
    browser,
    playwright,
  }) => {
    const treasurer = await sessionApi(playwright.request, 'admin');
    const payer = await sessionApi(playwright.request, 'renterA');
    const donor = await sessionApi(playwright.request, 'renterB');
    const context = await ledgerContext(browser, 'admin');

    try {
      const [payerAccount, donorAccount] = await Promise.all([
        myAccount(payer.api),
        myAccount(donor.api),
      ]);
      const run = `${NAMESPACE}-${Date.now()}`;
      const topUpText = namespaced('Top-up');
      const unclearText = namespaced('For the tool shed');
      const topUpAmount = uniqueAmount(40);
      const unclearAmount = uniqueAmount(15);
      const statement = camtStatement([
        {
          amount: topUpAmount,
          incoming: true,
          name: namespaced('Payer by reference'),
          // Online banking wraps long texts; the reference survives a space.
          text: `${topUpText} ${payerAccount.payment_reference.replace('-', '- ')}`,
          bankReference: `${run}-1`,
        },
        {
          amount: unclearAmount,
          incoming: true,
          name: namespaced('Unknown sender'),
          iban: 'AT611904300234573201',
          text: unclearText,
          bankReference: `${run}-2`,
        },
      ]);

      const page = await context.newPage();
      const bank = new LedgerBankPage(page);
      await bank.goto();
      await bank.upload(`statement-${run}.xml`, statement);
      await expect(bank.importedNotice).toBeVisible();

      // The reference names the member: one click books the top-up.
      const matched = bank.line(namespaced('Payer by reference'));
      await expect(bank.matchReason(matched, 'Payment reference')).toBeVisible();
      await expect(bank.quickAction(matched)).toHaveText(`Book to ${payerAccount.name}`);
      await bank.quickAction(matched).click();
      await expect(matched).toBeHidden();

      const [topUp] = await findTransactions(treasurer.api, topUpText);
      expect(topUp.kind).toBe('top_up');
      expect(effectOn(topUp, payerAccount.id)).toBe(Number(topUpAmount));

      // Nobody knows the sender yet: park it so the bank still adds up …
      const unclear = bank.line(namespaced('Unknown sender'));
      await bank.park(unclear, 'Ask at the next meeting');
      await expect(unclear).toBeHidden();

      // … and assign it once it turns out renterB sent it.
      await bank.tab('Parked');
      await bank.assignToMember(bank.line(namespaced('Unknown sender')), donorAccount.name);
      await bank.tab('Done');
      await expect(bank.line(namespaced('Unknown sender'))).toContainText('Booked as');

      const settled = (await findTransactions(treasurer.api, unclearText)).find(
        t => t.kind === 'top_up',
      );
      expect(settled && effectOn(settled, donorAccount.id)).toBe(Number(unclearAmount));
    } finally {
      await context.close();
      await Promise.all([treasurer.dispose(), payer.dispose(), donor.dispose()]);
    }
  });

  test('members cannot open the bank import', async ({ browser }) => {
    const context = await ledgerContext(browser, 'renterA');
    try {
      const bank = new LedgerBankPage(await context.newPage());
      await bank.goto();
      await expect(context.pages()[0].getByText(/Only the treasurer/)).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
