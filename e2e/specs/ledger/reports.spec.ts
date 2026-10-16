import { expect, test } from '../../fixtures';
import { LedgerReportPage, LedgerStatsPage } from '../../pages/ledger/LedgerReportsPages';
import { hasAllCredentials, env } from '../../support/config';
import { ledgerContext } from '../../support/ledger';

/** Statistics and the annual report (plan D7, D12) are readable by every member. */
test.describe('@regression @ledger reports', () => {
  test.skip(!hasAllCredentials(), 'E2E_<ROLE>_USERNAME/PASSWORD not configured');
  test.skip(!env.ledger, 'Ledger entries are permanent: local stacks only, or E2E_LEDGER=1');

  test('statistics and the annual report open and the books add up', async ({ browser }) => {
    const context = await ledgerContext(browser, 'renterB');
    try {
      const page = await context.newPage();

      const stats = new LedgerStatsPage(page);
      await stats.goto();
      await expect(stats.heading).toBeVisible();
      await expect(page.getByText('Income', { exact: true }).first()).toBeVisible();

      const report = new LedgerReportPage(page);
      await report.goto();
      await expect(report.booksAddUp).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
