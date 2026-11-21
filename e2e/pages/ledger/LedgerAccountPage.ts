import type { Locator, Page } from '@playwright/test';

import { BasePage } from '../BasePage';

/** /ledger/me — the member's own account, statement and payment details. */
export class LedgerAccountPage extends BasePage {
  readonly path = '/ledger/me';

  constructor(page: Page) {
    super(page);
  }

  get balance(): Locator {
    return this.testId('ledger-balance');
  }

  get paymentReference(): Locator {
    return this.testId('payment-reference');
  }

  /** A statement line, found by (a unique part of) its description. */
  statementLine(description: string): Locator {
    return this.page.getByRole('button').filter({ hasText: description });
  }
}
