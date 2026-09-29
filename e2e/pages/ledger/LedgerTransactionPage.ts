import type { Locator, Page } from '@playwright/test';

import { BasePage } from '../BasePage';

/** /ledger/t/:id — one transaction with its entries, receipts and disputes. */
export class LedgerTransactionPage extends BasePage {
  readonly path: string;

  constructor(page: Page, id: string) {
    super(page);
    this.path = `/ledger/t/${id}`;
  }

  get title(): Locator {
    return this.testId('transaction-title');
  }

  get seal(): Locator {
    return this.testId('transaction-seal');
  }

  /** An attached receipt, by file name. */
  receipt(fileName: string): Locator {
    return this.page.getByText(fileName);
  }

  entryRow(accountName: string): Locator {
    return this.page.getByRole('row').filter({ hasText: accountName });
  }

  async dispute(reason: string): Promise<void> {
    await this.page.getByRole('button', { name: 'Something is wrong' }).click();
    const dialog = this.page.getByRole('dialog');
    await dialog.getByRole('textbox').fill(reason);
    await dialog.getByRole('button', { name: 'Raise dispute' }).click();
    await dialog.waitFor({ state: 'hidden' });
  }

  /** An open or closed dispute on this transaction, by (part of) its reason. */
  disputeReason(text: string): Locator {
    return this.page.getByText(text);
  }

  /** Undo everything left of the transaction with a linked reversal. */
  async reverse(why: string): Promise<void> {
    await this.page.getByRole('button', { name: 'Reverse or correct' }).click();
    const dialog = this.page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: /Why\?/ }).fill(why);
    await dialog.getByRole('button', { name: 'Reverse', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  }

  /** On a correction: the link back to what it corrects. */
  get correctsOriginal(): Locator {
    return this.page.getByText('This corrects the');
  }

  /** On a corrected transaction: the link to its correction. */
  get correctedBy(): Locator {
    return this.page.getByText('Corrected by a');
  }
}
