import type { Locator, Page } from '@playwright/test';

import { BasePage } from './BasePage';

/**
 * The login / auth surface (rendered at "/" when unauthenticated with
 * REQUIRE_LOGIN, and at "/auth"). Uses resilient structural selectors until
 * data-testids are backfilled onto the form (plan §11).
 */
export class AuthPage extends BasePage {
  readonly path = '/auth';

  constructor(page: Page) {
    super(page);
  }

  get passwordInput(): Locator {
    return this.page.locator('input[type="password"]');
  }

  get submitButton(): Locator {
    return this.page.getByRole('button', { name: /log ?in|sign ?in|anmelden/i });
  }

  /** Whether the login form is currently displayed. */
  async isLoginFormVisible(): Promise<boolean> {
    return this.passwordInput.first().isVisible();
  }
}
