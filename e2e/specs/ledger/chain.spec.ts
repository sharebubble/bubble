import { readFile } from 'node:fs/promises';

import { expect, test } from '../../fixtures';
import { LedgerChainPage } from '../../pages/ledger/LedgerChainPage';
import { env, hasAllCredentials } from '../../support/config';
import { sessionApi } from '../../support/api';
import {
  categoryByCode,
  ledgerContext,
  postIntentWithReceipt,
  receiptPdf,
  sha256,
  uniqueAmount,
  verifyChainCsv,
} from '../../support/ledger';
import { namespaced } from '../../support/namespace';

/**
 * Tamper evidence (plan section 11): any member downloads the hash chain and
 * checks every link independently of the server's own verification.
 */
test.describe('@regression @ledger verify the books', () => {
  test.skip(!hasAllCredentials(), 'E2E_<ROLE>_USERNAME/PASSWORD not configured');
  test.skip(!env.ledger, 'Ledger entries are permanent: local stacks only, or E2E_LEDGER=1');

  test('a member downloads the chain and every link verifies', async ({ browser }) => {
    const context = await ledgerContext(browser, 'renterB');
    try {
      const chain = new LedgerChainPage(await context.newPage());
      await chain.goto();
      await expect(chain.head).toBeVisible();
      const shownHead = await chain.headHash();

      const download = await chain.downloadChain();
      const csv = (await readFile(await download.path())).toString('utf-8');
      const { head, length } = verifyChainCsv(csv);

      expect(length).toBeGreaterThan(0);
      // Other specs may post while this one runs, so the downloaded chain can
      // be longer than what the page showed, but it must contain that head.
      expect(csv).toContain(shownHead!);
      expect(head).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await context.close();
    }
  });

  test('receipts are sealed in a chain of their own', async ({ browser, playwright }) => {
    const member = await sessionApi(playwright.request, 'renterB');
    const context = await ledgerContext(browser, 'renterB');
    try {
      // A receipt attached to a new entry …
      const description = namespaced('Screws, with receipt');
      const posted = await postIntentWithReceipt(member.api, {
        amount: uniqueAmount(3),
        description,
        category: (await categoryByCode(member.api, 'consumables')).id,
        receipt: receiptPdf(),
      });
      expect(posted.receipt_count).toBe(1);

      // … shows up in the receipt chain, with the SHA-256 of its file.
      const chain = new LedgerChainPage(await context.newPage());
      await chain.goto();
      await expect(chain.receiptHead).toBeVisible();
      const download = await chain.downloadReceiptChain();
      const csv = (await readFile(await download.path())).toString('utf-8');
      expect(verifyChainCsv(csv).length).toBeGreaterThan(0);
      expect(csv).toContain(sha256(receiptPdf()));
    } finally {
      await member.dispose();
      await context.close();
    }
  });
});
