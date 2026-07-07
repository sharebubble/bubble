import { env } from './config';

/**
 * Every record a test creates is tagged with a run-scoped namespace so parallel
 * runs/workers never collide and cleanup is exact (delete only what we tagged).
 * See docs/e2e-testing/plan.md §6.3.
 */
export const NAMESPACE = `E2E-${env.runId}`;

/** Prefix a human-readable name with the run namespace, e.g. "E2E-123::Drill". */
export function namespaced(name: string): string {
  return `${NAMESPACE}::${name}`;
}

/** True if a value was created by this (or any) E2E run. */
export function isNamespaced(name: string | null | undefined): boolean {
  return !!name && name.startsWith('E2E-');
}
