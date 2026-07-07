const baseArg = process.argv[2];

if (!baseArg) {
    console.error('Usage: node scripts/release-health-check.mjs https://your-staging-url.com');
    process.exit(2);
}

const baseUrl = baseArg.replace(/\/+$/, '');
const expectedSaveStore = process.env.EXPECTED_SAVE_STORE || '';

async function fetchJson(path) {
    const url = `${baseUrl}${path}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    const text = await res.text();
    let body;
    try {
        body = text ? JSON.parse(text) : {};
    } catch {
        throw new Error(`${url} returned non-JSON body with HTTP ${res.status}`);
    }
    if (!res.ok) {
        throw new Error(`${url} failed with HTTP ${res.status}: ${JSON.stringify(body)}`);
    }
    return body;
}

function assertOk(condition, message) {
    if (!condition) throw new Error(message);
}

try {
    console.log(`[release-health] Checking ${baseUrl}`);
    const shallow = await fetchJson('/health');
    assertOk(shallow.ok === true, '/health did not return ok:true');
    console.log(`[release-health] /health ok commit=${shallow.commit ?? 'unknown'} startedAt=${shallow.startedAt ?? 'unknown'}`);

    const deep = await fetchJson('/health?deep=1');
    assertOk(deep.ok === true, '/health?deep=1 did not return ok:true');
    console.log(`[release-health] /health?deep=1 ok saveStore=${deep.saveStore ?? 'unknown'} latencyMs=${deep.latencyMs ?? 'unknown'}`);

    if (expectedSaveStore) {
        assertOk(deep.saveStore === expectedSaveStore, `saveStore mismatch: expected ${expectedSaveStore}, got ${deep.saveStore ?? 'unknown'}`);
    }

    if (process.env.REQUIRE_DISK_OVERLAY === '1') {
        assertOk(deep.saveStore && deep.saveStore !== 'base-store', 'REQUIRE_DISK_OVERLAY=1 but deep health reports base-store');
    }

    console.log('[release-health] PASS');
} catch (err) {
    console.error(`[release-health] FAIL: ${err.message}`);
    process.exit(1);
}
