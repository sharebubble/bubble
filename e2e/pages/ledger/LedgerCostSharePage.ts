import type { Locator, Page } from '@playwright/test';

import { BasePage } from '../BasePage';

/** /ledger/splits/:id — a shared cost and every participant's answer. */
export class LedgerCostSharePage extends BasePage {
  readonly path: string;

  constructor(page: Page, id: string) {
    super(page);
    this.path = `/ledger/splits/${id}`;
  }

  async accept(): Promise<void> {
    await this.page.getByRole('button', { name: 'Accept', exact: true }).click();
  }

  get acceptButton(): Locator {
    return this.page.getByRole('button', { name: 'Accept', exact: true });
  }

  /** The state badge, e.g. "Open" or "Booked". */
  state(label: string): Locator {
    return this.page.getByText(label, { exact: true }).first();
  }
}
