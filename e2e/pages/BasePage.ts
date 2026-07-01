import type { Page } from '@playwright/test';

/**
 * Base for all Page Objects. Concrete pages expose intent-revealing methods and
 * locators; specs never touch raw selectors directly.
 *
 * Selector policy (plan §4/§11): prefer stable `data-testid` via `testId()`.
 * The AI generator backfills missing testids into the React components as
 * coverage grows, so pages stay resilient to Mantine markup changes.
 */
export abstract class BasePage {
  constructor(protected readonly page: Page) {}

  /** Path this page lives at, relative to baseURL (e.g. "/", "/my-items"). */
  abstract readonly path: string;

  async goto(): Promise<void> {
    await this.page.goto(this.path);
  }

  protected testId(id: string) {
    return this.page.getByTestId(id);
  }
}
