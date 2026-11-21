import type { Download, Locator, Page } from '@playwright/test';

import { BasePage } from '../BasePage';

/** /ledger/chain — "Verify the books": the hash chain and nightly digests. */
export class LedgerChainPage extends BasePage {
  readonly path = '/ledger/chain';

  constructor(page: Page) {
    super(page);
  }

  get head(): Locator {
    return this.testId('chain-head-hash');
  }

  async headHash(): Promise<string | null> {
    return this.head.getAttribute('data-hash');
  }

  /** The newest link of the receipt chain; absent while no receipt exists. */
  get receiptHead(): Locator {
    return this.testId('receipt-chain-head-hash');
  }

  async downloadReceiptChain(): Promise<Download> {
    const download = this.page.waitForEvent('download');
    await this.testId('receipt-chain-download').click();
    return download;
  }

  async downloadChain(): Promise<Download> {
    const download = this.page.waitForEvent('download');
    await this.testId('chain-download').click();
    return download;
  }
}
