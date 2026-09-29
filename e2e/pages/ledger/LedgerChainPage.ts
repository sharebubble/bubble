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

  async downloadChain(): Promise<Download> {
    const download = this.page.waitForEvent('download');
    await this.testId('chain-download').click();
    return download;
  }
}
