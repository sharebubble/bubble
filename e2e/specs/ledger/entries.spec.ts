import { expect, test } from '../../fixtures';
import { LedgerPage } from '../../pages/ledger/LedgerPage';
import { LedgerTransactionPage } from '../../pages/ledger/LedgerTransactionPage';
import { sessionApi } from '../../support/api';
import { env, hasAllCredentials } from '../../support/config';
import {
  effectOn,
  findTransaction,
  ledgerContext,
  myAccount,
  receiptPdf,
  uniqueAmount,
} from '../../support/ledger';
import { namespaced } from '../../support/namespace';

/**
 * Manual entries (plan section 7): a member records money they spent for the
 * community, with a receipt, and money they paid in. Both charge only the
 * member's own account.
 */
test.describe('@regression @ledger manual entries', () => {
  test.skip(!hasAllCredentials(), 'E2E_<ROLE>_USERNAME/PASSWORD not configured');
  test.skip(!env.ledger, 'Ledger entries are permanent: local stacks only, or E2E_LEDGER=1');

  test('a member posts an expense with a receipt, then a top-up', async ({
    browser,
    playwright,
  }) => {
    const member = await sessionApi(playwright.request, 'renterA');
    const context = await ledgerContext(browser, 'renterA');
    const page = await context.newPage();
    const ledger = new LedgerPage(page);

    try {
      const me = await myAccount(member.api);

      // An expense for the community, with its receipt.
      const expense = namespaced('Drill bits for the workshop');
      const expenseAmount = uniqueAmount(12);
      await ledger.goto();
      const dialog = await ledger.openNewEntry();
      await dialog.fill({
        intent: 'I paid for the community',
        amount: expenseAmount,
        description: expense,
        category: 'Tools and equipment',
        receipt: { name: 'receipt.pdf', buffer: receiptPdf() },
      });
      await dialog.submit();

      // The app opens the new entry: its receipt and its seal in the hash chain.
      const posted = await findTransaction(member.api, expense);
      const detail = new LedgerTransactionPage(page, posted.id);
      await expect(detail.title).toHaveText(expense);
      await expect(detail.receipt('receipt.pdf')).toBeVisible();
      await expect(detail.seal).toBeVisible();
      expect(posted.kind).toBe('member_expense');
      expect(posted.receipt_count).toBe(1);
      // The community owes the member what they spent.
      expect(effectOn(posted, me.id)).toBe(Number(expenseAmount));

      // Every member sees it in the community feed.
      await ledger.goto();
      await ledger.search(expense);
      await expect(ledger.feedRow(expense)).toBeVisible();

      // Money paid in by bank transfer.
      const topUp = namespaced('Top-up by transfer');
      const topUpAmount = uniqueAmount(20);
      await ledger.goto();
      const second = await ledger.openNewEntry();
      await second.fill({ intent: 'I paid money in', amount: topUpAmount, description: topUp });
      await second.submit();
      const paidIn = await findTransaction(member.api, topUp);
      await expect(new LedgerTransactionPage(page, paidIn.id).title).toHaveText(topUp);
      expect(paidIn.kind).toBe('top_up');
      expect(effectOn(paidIn, me.id)).toBe(Number(topUpAmount));
    } finally {
      await context.close();
      await member.dispose();
    }
  });
});
