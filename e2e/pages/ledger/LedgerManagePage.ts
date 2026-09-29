import type { Download, Locator, Page } from '@playwright/test';

import { BasePage } from '../BasePage';

/** /ledger/manage — categories, projects, closed periods and exports. */
export class LedgerManagePage extends BasePage {
  readonly path = '/ledger/manage';

  constructor(page: Page) {
    super(page);
  }

  async closePeriod(startsOn: string, endsOn: string): Promise<void> {
    await this.testId('close-period').click();
    const dialog = this.page.getByRole('dialog', { name: 'Close a period' });
    await dialog.getByLabel('Starts').fill(startsOn);
    await dialog.getByLabel('Ends').fill(endsOn);
    await dialog.getByRole('button', { name: 'Close a period' }).click();
    await dialog.waitFor({ state: 'hidden' });
  }

  period(startsOn: string): Locator {
    return this.page.locator(`[data-testid="ledger-period"][data-starts-on="${startsOn}"]`);
  }

  /** The full journal fingerprint recorded for a closed period. */
  async periodHash(startsOn: string): Promise<string | null> {
    return this.period(startsOn).locator('[data-hash]').getAttribute('data-hash');
  }

  async downloadJournal(dateFrom: string, dateTo: string): Promise<Download> {
    await this.testId('export-date-from').fill(dateFrom);
    await this.testId('export-date-to').fill(dateTo);
    const download = this.page.waitForEvent('download');
    await this.testId('export-journal').click();
    return download;
  }
}
