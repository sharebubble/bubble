import { readFile } from 'node:fs/promises';

import { expect, test } from '../../fixtures';
import { LedgerChainPage } from '../../pages/ledger/LedgerChainPage';
import { env, hasAllCredentials } from '../../support/config';
import { ledgerContext, verifyChainCsv } from '../../support/ledger';

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
});
