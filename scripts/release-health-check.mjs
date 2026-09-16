import { evaluateRequestSlo } from './_release-health-slo.mjs';

const baseArg = process.argv[2];

if (!baseArg) {
    console.error('Usage: node scripts/release-health-check.mjs https://your-staging-url.com');
    process.exit(2);
}

const baseUrl = baseArg.replace(/\/+$/, '');
const expectedSaveStore = process.env.EXPECTED_SAVE_STORE || '';
const expectedCommit = String(process.env.EXPECTED_COMMIT || '').trim().toLowerCase();
const deepHealthToken = String(process.env.HEALTH_DEEP_TOKEN || '').trim();
const requestTimeoutMs = Number(process.env.HEALTH_REQUEST_TIMEOUT_MS || 15_000);

if (!deepHealthToken) {
    console.error('HEALTH_DEEP_TOKEN is required for the release readiness probe.');
    process.exit(2);
}
if (process.env.REQUIRE_EXPECTED_COMMIT === '1' && !/^[0-9a-f]{40}$/.test(expectedCommit)) {
    console.error('A full EXPECTED_COMMIT is required for release certification.');
    process.exit(2);
}
if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0 || requestTimeoutMs > 60_000) {
    console.error('HEALTH_REQUEST_TIMEOUT_MS must be an integer from 1 to 60000.');
    process.exit(2);
}

async function fetchJson(path) {
    const url = `${baseUrl}${path}`;
    const headers = { accept: 'application/json' };
    if (deepHealthToken) headers.authorization = `Bearer ${deepHealthToken}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(requestTimeoutMs) });
    const text = await res.text();
    let body;
    try {
        body = text ? JSON.parse(text) : {};
    } catch {
        throw new Error(`${url} returned non-JSON body with HTTP ${res.status}`);
    }
    if (!res.ok) {
        throw new Error(`${url} failed with HTTP ${res.status}`);
    }
    return body;
}

function assertOk(condition, message) {
    if (!condition) throw new Error(message);
}

function checkCommit(body, path) {
    const actual = String(body.commit ?? '').trim().toLowerCase();
    if (process.env.REQUIRE_KNOWN_COMMIT === '1' || expectedCommit) {
        assertOk(/^[0-9a-f]{7,64}$/.test(actual), `${path} did not return a known commit`);
    }
    if (expectedCommit) assertOk(actual === expectedCommit, `${path} commit mismatch: expected ${expectedCommit}, got ${actual}`);
    return actual;
}

try {
    console.log(`[release-health] Checking ${baseUrl}`);
    const shallow = await fetchJson('/health');
    assertOk(shallow.ok === true, '/health did not return ok:true');
    console.log(`[release-health] /health ok commit=${shallow.commit ?? 'unknown'} startedAt=${shallow.startedAt ?? 'unknown'}`);
    const shallowCommit = checkCommit(shallow, '/health');

    const deep = await fetchJson('/health?deep=1');
    assertOk(deep.ok === true, '/health?deep=1 did not return ok:true');
    const deepCommit = checkCommit(deep, '/health?deep=1');
    assertOk(deepCommit === shallowCommit, 'Deployment changed between shallow and deep health; repeat the probe.');
    console.log(`[release-health] /health?deep=1 ok saveStore=${deep.saveStore ?? 'unknown'} latencyMs=${deep.latencyMs ?? 'unknown'}`);

    if (expectedSaveStore) {
        assertOk(deep.saveStore === expectedSaveStore, `saveStore mismatch: expected ${expectedSaveStore}, got ${deep.saveStore ?? 'unknown'}`);
    }

    if (process.env.REQUIRE_DISK_OVERLAY === '1') {
        assertOk(deep.saveStore && deep.saveStore !== 'base-store', 'REQUIRE_DISK_OVERLAY=1 but deep health reports base-store');
    }

    if (process.env.REQUIRE_FRESH_BACKUP === '1') {
        assertOk(deep.backup?.fresh === true, `backup freshness failed: ${JSON.stringify(deep.backup ?? null)}`);
    }

    // Opt in after representative local/staging traffic, not during a new
    // instance's liveness probe. A quiet server has insufficient evidence.
    if (process.env.REQUIRE_REQUEST_SLO === '1') {
        const result = evaluateRequestSlo(deep.requestMetrics);
        console.log(`[release-health] request SLO ${result.status}: ${result.reason}`);
        if (result.exitCode) process.exit(result.exitCode);
    }

    console.log('[release-health] PASS');
} catch (err) {
    console.error(`[release-health] FAIL: ${err.message}`);
    process.exit(1);
}
