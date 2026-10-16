import type { Locator, Page } from '@playwright/test';

import { BasePage } from '../BasePage';

/** /ledger/stats — totals and groupings for a period. */
export class LedgerStatsPage extends BasePage {
  readonly path = '/ledger/stats';

  constructor(page: Page) {
    super(page);
  }

  get heading(): Locator {
    return this.page.getByRole('heading', { name: 'Statistics', level: 1 });
  }
}

/** /ledger/report — the treasurer's annual report, readable by every member. */
export class LedgerReportPage extends BasePage {
  readonly path = '/ledger/report';

  constructor(page: Page) {
    super(page);
  }

  get booksAddUp(): Locator {
    return this.page.getByText('The books add up');
  }
}
