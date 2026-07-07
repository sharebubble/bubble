import type { Page } from '@playwright/test';

import { BasePage } from './BasePage';

/** The item catalog / home page. */
export class IndexPage extends BasePage {
  readonly path = '/';

  constructor(page: Page) {
    super(page);
  }

  /** The app shell has mounted (React root has children). */
  async isLoaded(): Promise<boolean> {
    await this.page.locator('#root, body').first().waitFor({ state: 'attached' });
    return true;
  }
}
