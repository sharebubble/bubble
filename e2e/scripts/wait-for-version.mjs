#!/usr/bin/env node
/**
 * Version guard for the release-gate pipeline (docs/e2e-testing/plan.md §7.2).
 *
 * Polls the deployed backend (GET /api/version) and frontend (GET /version.json)
 * until BOTH report the commit under test, then exits 0. Exits non-zero on
 * timeout. This is what makes E2E trustworthy under ArgoCD rolling updates: it
 * blocks tests until stage is actually serving the exact commit, not the
 * previous image still behind the Service during a rollout.
 *
 * Usage:
 *   node scripts/wait-for-version.mjs <expected-sha>
 *   EXPECTED_SHA=<sha> node scripts/wait-for-version.mjs
 *
 * Env:
 *   E2E_BASE_URL   frontend origin      (default https://main.sharebubble.org)
 *   E2E_API_URL    backend origin       (default: E2E_BASE_URL)
 *   E2E_WAIT_TIMEOUT_MS   overall budget (default 600000 = 10 min)
 *   E2E_WAIT_INTERVAL_MS  poll interval  (default 10000 = 10 s)
 */

const expected = (process.argv[2] || process.env.EXPECTED_SHA || '').trim();
if (!expected) {
  console.error('Expected git SHA required: pass as arg or set EXPECTED_SHA.');
  process.exit(2);
}

const baseURL = (process.env.E2E_BASE_URL || 'https://main.sharebubble.org').replace(/\/$/, '');
const apiURL = (process.env.E2E_API_URL || baseURL).replace(/\/$/, '');
const timeoutMs = Number(process.env.E2E_WAIT_TIMEOUT_MS || 600_000);
const intervalMs = Number(process.env.E2E_WAIT_INTERVAL_MS || 10_000);

/** SHAs match if one is a prefix of the other (handles short 7 vs full 40). */
function shaMatches(served) {
  if (!served) return false;
  return served.startsWith(expected) || expected.startsWith(served);
}

async function fetchSha(url) {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = await res.json();
    return { ok: true, sha: String(body.git_sha || '') };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const deadline = Date.now() + timeoutMs;
  const backendUrl = `${apiURL}/api/version/`;
  const frontendUrl = `${baseURL}/version.json`;
  console.log(
    `Waiting for git_sha=${expected} on:\n  backend  ${backendUrl}\n  frontend ${frontendUrl}`,
  );

  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const [backend, frontend] = await Promise.all([fetchSha(backendUrl), fetchSha(frontendUrl)]);
    const backendOk = backend.ok && shaMatches(backend.sha);
    const frontendOk = frontend.ok && shaMatches(frontend.sha);

    if (backendOk && frontendOk) {
      console.log(`✓ both tiers serving ${expected} (after ${attempt} attempt(s))`);
      process.exit(0);
    }

    console.log(
      `attempt ${attempt}: backend=${backendOk ? 'ok' : backend.sha || backend.detail}` +
        ` frontend=${frontendOk ? 'ok' : frontend.sha || frontend.detail}`,
    );
    await sleep(intervalMs);
  }

  console.error(`✗ timed out after ${timeoutMs}ms waiting for ${expected}`);
  process.exit(1);
}

main();
