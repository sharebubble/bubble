import type { Locator, Page } from '@playwright/test';

import { BasePage } from '../BasePage';

export type Intent =
  | 'I paid for the community'
  | 'I paid money in'
  | 'I owe another member'
  | 'Pay a member out'
  | 'Community income';

/** The "New entry" dialog on /ledger. */
export class NewEntryDialog {
  constructor(private readonly page: Page) {}

  get root(): Locator {
    return this.page.getByRole('dialog', { name: 'New entry' });
  }

  private async choose(label: string, option: string): Promise<void> {
    await this.root.getByRole('combobox', { name: label }).click();
    await this.page.getByRole('option', { name: option, exact: true }).click();
  }

  async fill(entry: {
    intent: Intent;
    amount: string;
    description: string;
    category?: string;
    member?: string;
    receipt?: { name: string; buffer: Buffer };
  }): Promise<void> {
    await this.choose('What happened?', entry.intent);
    await this.root.getByRole('textbox', { name: 'Amount' }).fill(entry.amount);
    await this.root.getByRole('textbox', { name: 'Description' }).fill(entry.description);
    if (entry.category) await this.choose('Category', entry.category);
    if (entry.member) {
      await this.root
        .getByRole('combobox', { name: /Whom do you owe|Who is paid out/ })
        .fill(entry.member);
      await this.page.getByRole('option', { name: entry.member, exact: true }).click();
    }
    if (entry.receipt) {
      await this.root.locator('input[type="file"]').setInputFiles({
        name: entry.receipt.name,
        mimeType: 'application/pdf',
        buffer: entry.receipt.buffer,
      });
    }
  }

  /** Post the entry; the app then opens the new transaction's page. */
  async submit(): Promise<void> {
    await this.root.getByTestId('ledger-entry-submit').click();
    await this.root.waitFor({ state: 'hidden' });
    await this.page.waitForURL(/\/ledger\/t\/[0-9a-f-]+$/);
  }
}

/** The "Split a cost" dialog on /ledger. */
export class SplitDialog {
  constructor(private readonly page: Page) {}

  get root(): Locator {
    return this.page.getByRole('dialog');
  }

  async fill(split: { description: string; total: string; participants: string[] }) {
    await this.root.getByRole('textbox', { name: 'Description' }).fill(split.description);
    await this.root.getByRole('textbox', { name: 'Total paid' }).fill(split.total);
    const participants = this.root.getByRole('combobox', { name: 'Participants' });
    for (const name of split.participants) {
      await participants.click();
      await participants.fill(name);
      await this.page.getByRole('option', { name, exact: true }).click();
    }
  }

  async send(): Promise<void> {
    await this.root.getByRole('button', { name: 'Send to participants' }).click();
    await this.root.waitFor({ state: 'hidden' });
  }
}

/** /ledger: the community feed, balances and splits. */
export class LedgerPage extends BasePage {
  readonly path = '/ledger';

  constructor(page: Page) {
    super(page);
  }

  async openNewEntry(): Promise<NewEntryDialog> {
    await this.testId('ledger-new-entry').click();
    return new NewEntryDialog(this.page);
  }

  async openSplit(): Promise<SplitDialog> {
    await this.testId('ledger-split').click();
    return new SplitDialog(this.page);
  }

  /** A row of the feed, found by (a unique part of) its description. */
  feedRow(description: string): Locator {
    return this.page.getByRole('button').filter({ hasText: description });
  }

  async search(text: string): Promise<void> {
    await this.page.getByRole('textbox', { name: 'Search descriptions' }).fill(text);
  }
}
