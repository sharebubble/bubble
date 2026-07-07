/**
 * Run-scoped test-data tracker.
 *
 * Records a teardown callback for every resource a test creates and runs them in
 * reverse order at the end of the test, so data is cleaned up even when
 * assertions fail. Concrete factories (items, bookings, collections, ...) are
 * added in Phase C on top of verified API endpoints; this tracker is the
 * lifecycle backbone they plug into. See docs/e2e-testing/plan.md §6.
 */
export class TestData {
  private readonly teardowns: Array<() => Promise<void>> = [];

  /** Register a cleanup callback for a resource this test created. */
  remember(teardown: () => Promise<void>): void {
    this.teardowns.push(teardown);
  }

  /** Run all registered teardowns (reverse order); collect, don't throw. */
  async cleanup(): Promise<void> {
    const errors: unknown[] = [];
    for (const teardown of this.teardowns.reverse()) {
      try {
        await teardown();
      } catch (error) {
        errors.push(error);
      }
    }
    this.teardowns.length = 0;
    if (errors.length > 0) {
      // Surface leaks loudly; the nightly janitor is the backstop (plan §6.3).
      console.error(`[e2e] ${errors.length} teardown(s) failed:`, errors);
    }
  }
}
