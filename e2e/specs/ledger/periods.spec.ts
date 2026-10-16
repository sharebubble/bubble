import { readFile } from 'node:fs/promises';

import { expect, test } from '../../fixtures';
import { LedgerManagePage } from '../../pages/ledger/LedgerManagePage';
import { sessionApi } from '../../support/api';
import { env, hasAllCredentials } from '../../support/config';
import { closedPeriods, daysBefore, ledgerContext, postIntent, sha256 } from '../../support/ledger';
import { NAMESPACE } from '../../support/namespace';

/**
 * Period close (plan section 13): the treasurer closes a period, which records
 * the SHA-256 of its journal; the downloaded journal matches it, and nothing
 * can be booked into the period afterwards.
 *
 * Closing cannot be undone, so each run closes one more day in the distant
 * past (the day before the earliest closed period), which never touches the
 * entries other specs post today.
 */
test.describe('@regression @ledger period close', () => {
  test.skip(!hasAllCredentials(), 'E2E_<ROLE>_USERNAME/PASSWORD not configured');
  test.skip(!env.ledger, 'Ledger entries are permanent: local stacks only, or E2E_LEDGER=1');

  test('a closed period records its journal fingerprint and refuses entries', async ({
    browser,
    playwright,
  }) => {
    const treasurer = await sessionApi(playwright.request, 'admin');
    const member = await sessionApi(playwright.request, 'renterA');
    const context = await ledgerContext(browser, 'admin');

    try {
      const earliest = (await closedPeriods(treasurer.api))
        .map(period => period.starts_on)
        .sort()[0];
      const day = daysBefore(earliest ?? '2000-01-01', 1);

      const manage = new LedgerManagePage(await context.newPage());
      await manage.goto();
      await manage.closePeriod(day, day);
      await expect(manage.period(day)).toBeVisible();

      // The journal downloaded now has exactly the recorded fingerprint.
      const recorded = await manage.periodHash(day);
      const download = await manage.downloadJournal(day, day);
      const journal = await readFile(await download.path());
      expect(sha256(journal)).toBe(recorded);

      // Nothing can be booked into the closed day any more.
      const refused = await member.api.tryPostJson('/api/ledger/transactions/', {
        intent: 'top_up',
        amount: '5.00',
        description: 'Late entry',
        occurred_on: day,
        via: 'cash',
      });
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.body)).toMatch(/closed/);

      // Booking with today's date still works.
      await expect(
        postIntent(member.api, {
          intent: 'top_up',
          amount: '0.01',
          description: `${NAMESPACE}::Ping after closing`,
        }),
      ).resolves.toBeTruthy();
    } finally {
      await context.close();
      await Promise.all([treasurer.dispose(), member.dispose()]);
    }
  });
});
