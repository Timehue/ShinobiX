import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const commit = '4d286c4a55b54a805807160ac6f71ca11267364b';
const other = '2d9c92f6d19527672d4d93996fb62ec2c9773191';
const token = 'local-readiness-test-only';

async function probe({ shallow = {}, deep = {}, status = 200, env = {}, hang = false, raw } = {}) {
    const requests = [];
    const server = createServer((req, res) => {
        requests.push({ path: req.url, authorization: req.headers.authorization });
        if (hang) return;
        const isDeep = req.url.includes('deep=1');
        res.writeHead(isDeep ? status : 200, { 'content-type': 'application/json' });
        res.end(raw ?? JSON.stringify(isDeep
            ? { ok: true, commit, saveStore: 'base-store', backup: { fresh: true }, ...deep }
            : { ok: true, commit, ...shallow }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let output = '';
    try {
        const child = spawn(process.execPath, ['scripts/release-health-check.mjs', `http://127.0.0.1:${server.address().port}`], {
            cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, HEALTH_DEEP_TOKEN: token, EXPECTED_COMMIT: commit,
                EXPECTED_SAVE_STORE: 'base-store', REQUIRE_KNOWN_COMMIT: '1', REQUIRE_EXPECTED_COMMIT: '1',
                REQUIRE_FRESH_BACKUP: '1', REQUIRE_DISK_OVERLAY: '0', HEALTH_REQUEST_TIMEOUT_MS: '1000', ...env },
        });
        child.stdout.on('data', data => { output += data; });
        child.stderr.on('data', data => { output += data; });
        const exit = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
        assert.ok(!output.includes(token), 'probe credentials never reach output');
        return { exit, output, requests };
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}

test('production readiness certifies the same intended build, live storage and a fresh backup', async () => {
    const result = await probe();
    assert.equal(result.exit, 0, result.output);
    assert.match(result.output, /\[release-health\] PASS/);
    assert.deepEqual(result.requests.map(request => request.path), ['/health', '/health?deep=1']);
    assert.ok(result.requests.every(request => request.authorization === `Bearer ${token}`));
});

for (const [name, options, error] of [
    ['wrong shallow build', { shallow: { commit: other } }, /commit mismatch/],
    ['cutover between shallow and deep', { deep: { commit: other } }, /deep=1.*commit mismatch/],
    ['missing deep identity', { deep: { commit: null } }, /known commit/],
    ['unknown shallow identity', { shallow: { commit: 'unknown' } }, /known commit/],
    ['wrong store', { deep: { saveStore: 'disk-overlay' } }, /saveStore mismatch/],
    ['stale backup', { deep: { backup: { fresh: false } } }, /backup freshness/],
    ['missing backup', { deep: { backup: null } }, /backup freshness/],
    ['unauthorized protected probe', { status: 401 }, /HTTP 401/],
    ['unhealthy protected store', { status: 503, deep: { error: 'private-provider-diagnostic' } }, /HTTP 503/],
    ['non-JSON transport reply', { raw: '<html>unavailable</html>' }, /non-JSON/],
    ['missing token', { env: { HEALTH_DEEP_TOKEN: '' } }, /HEALTH_DEEP_TOKEN is required/],
    ['missing intended commit', { env: { EXPECTED_COMMIT: '' } }, /full EXPECTED_COMMIT/],
    ['unresponsive endpoint', { hang: true, env: { HEALTH_REQUEST_TIMEOUT_MS: '200' } }, /FAIL/],
]) {
    test(`production readiness rejects ${name}`, async () => {
        const result = await probe(options);
        assert.notEqual(result.exit, 0, result.output);
        assert.match(result.output, error);
        assert.doesNotMatch(result.output, /\[release-health\] PASS|private-provider-diagnostic/);
    });
}
