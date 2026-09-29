import { expect, type Locator, type Page } from '@playwright/test';

import { BasePage } from '../BasePage';

/** /ledger/bank — the treasurer's statement import and review. */
export class LedgerBankPage extends BasePage {
  readonly path = '/ledger/bank';

  constructor(page: Page) {
    super(page);
  }

  async upload(fileName: string, buffer: Buffer): Promise<void> {
    const chooser = this.page.waitForEvent('filechooser');
    await this.page.getByRole('button', { name: 'Upload statement' }).click();
    await (await chooser).setFiles({ name: fileName, mimeType: 'application/xml', buffer });
  }

  get importedNotice(): Locator {
    return this.page.getByText(/new lines imported/);
  }

  async tab(name: 'To review' | 'Parked' | 'Done'): Promise<void> {
    await this.page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
  }

  /** The card of one bank line, found by its sender or recipient. */
  line(counterparty: string): Locator {
    return this.testId('bank-line').filter({ hasText: counterparty });
  }

  /** The badge saying why the matcher proposes a member ("Payment reference", …). */
  matchReason(line: Locator, reason: string): Locator {
    return line.getByText(reason, { exact: true });
  }

  /** The one-click action the matcher proposes ("Book to …" / "Match with #…"). */
  quickAction(line: Locator): Locator {
    return line.getByTestId('bank-line-quick');
  }

  async park(line: Locator, note: string): Promise<void> {
    await line.getByTestId('bank-line-menu').click();
    await this.page.getByRole('menuitem', { name: 'Park until clarified…' }).click();
    const dialog = this.page.getByRole('dialog');
    await dialog.getByRole('textbox').fill(note);
    await dialog.getByRole('button', { name: 'Park', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  }

  async assignToMember(line: Locator, member: string): Promise<void> {
    await line.getByRole('button', { name: 'Assign' }).click();
    const dialog = this.page.getByRole('dialog');
    const select = dialog.getByRole('combobox', { name: 'Member' });
    // The matcher may already have proposed the member; picking it again keeps it.
    await select.click();
    await this.page.getByRole('option', { name: member, exact: true }).click();
    await expect(select).toHaveValue(member);
    await dialog.getByRole('button', { name: 'Book', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  }
}
