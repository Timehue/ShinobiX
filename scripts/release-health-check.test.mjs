import assert from 'node:assert/strict';
import { once } from 'node:events';
import { evaluateRequestSlo } from './_release-health-slo.mjs';
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

const healthy = { count: 25, slo: { healthy: true, evaluable: true, minimumRequests: 20, breaches: [] } };

test('SLO assessment rejects absent, contradictory and insufficient evidence', () => {
    assert.equal(evaluateRequestSlo(healthy).status, 'PASS');
    assert.equal(evaluateRequestSlo({ ...healthy, slo: { ...healthy.slo, healthy: false } }).status, 'FAIL');
    assert.equal(evaluateRequestSlo({ ...healthy, slo: { ...healthy.slo, breaches: ['latency breached'] } }).status, 'FAIL');
    for (const sample of [undefined, {}, { ...healthy, count: 0 },
        { ...healthy, slo: { ...healthy.slo, evaluable: false } },
        { ...healthy, count: NaN }, { ...healthy, slo: { ...healthy.slo, minimumRequests: 0 } }]) {
        assert.equal(evaluateRequestSlo(sample).status, 'INSUFFICIENT_DATA');
    }
});

test('release probe preserves default readiness and opt-in exit semantics over real loopback HTTP', async () => {
    let metrics;
    const paths = [];
    const server = createServer((req, res) => {
        paths.push(req.url);
        assert.equal(req.headers.authorization, 'Bearer local-test-token');
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(req.url === '/health' ? { ok: true, commit }
            : { ok: true, commit, saveStore: 'test-memory', requestMetrics: metrics }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        for (const scenario of [
            { enabled: false, metrics: undefined, code: 0, text: /\[release-health\] PASS/ },
            { enabled: true, metrics: healthy, code: 0, text: /request SLO PASS/ },
            { enabled: true, metrics: { ...healthy, slo: { ...healthy.slo, healthy: false, breaches: ['p95 breached'] } }, code: 1, text: /request SLO FAIL/ },
            { enabled: true, metrics: { ...healthy, count: 3, slo: { ...healthy.slo, evaluable: false } }, code: 2, text: /request SLO INSUFFICIENT_DATA/ },
            { enabled: true, metrics: undefined, code: 2, text: /request SLO INSUFFICIENT_DATA/ },
        ]) {
            metrics = scenario.metrics;
            const child = spawn(process.execPath, [fileURLToPath(new URL('./release-health-check.mjs', import.meta.url)),
                `http://127.0.0.1:${server.address().port}`], {
                env: { ...process.env, HEALTH_DEEP_TOKEN: 'local-test-token', EXPECTED_COMMIT: commit, REQUIRE_EXPECTED_COMMIT: '1',
                    EXPECTED_SAVE_STORE: 'test-memory', REQUIRE_KNOWN_COMMIT: '1', REQUIRE_DISK_OVERLAY: '',
                    REQUIRE_FRESH_BACKUP: '', REQUIRE_REQUEST_SLO: scenario.enabled ? '1' : '' },
                windowsHide: true,
            });
            let output = '';
            child.stdout.on('data', value => { output += value; });
            child.stderr.on('data', value => { output += value; });
            const [code] = await once(child, 'close');
            assert.equal(code, scenario.code, output);
            assert.match(output, scenario.text);
            if (code) assert.doesNotMatch(output, /\[release-health\] PASS/);
        }
        assert.deepEqual(paths, Array.from({ length: 5 }, () => ['/health', '/health?deep=1']).flat());
    } finally {
        server.close();
        await once(server, 'close');
    }
});
