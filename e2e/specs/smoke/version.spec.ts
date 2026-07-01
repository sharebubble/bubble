import { expect, test } from '../../fixtures';

/**
 * The version endpoint underpins the release-gate version guard, so its shape is
 * itself part of the contract we protect.
 */
test.describe('@smoke version endpoint', () => {
  test('GET /api/version returns git_sha and version strings', async ({ api }) => {
    const info = await api.version();

    expect(info).toHaveProperty('git_sha');
    expect(info).toHaveProperty('version');
    expect(typeof info.git_sha).toBe('string');
    expect(typeof info.version).toBe('string');
  });
});
