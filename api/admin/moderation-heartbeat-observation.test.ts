import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('../_storage.js').kv;
let moderation: Pick<typeof import('./moderation.js'),
    '_resetHeartbeatObservationMemo' | '_shouldRecheckHeartbeatObservation' | 'recordHeartbeatObservation'>;

const NAME = 'beatwatcher';
const FIVE_MIN = 5 * 60_000;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    moderation = await import('./moderation.js');
});

beforeEach(async () => {
    moderation._resetHeartbeatObservationMemo();
    await kv.del(`mod:ip-v2:${NAME}`, `mod:fp:${NAME}`, 'mod:by-ip-v2:8.8.8.8', 'mod:by-ip-v2:1.1.1.1', 'mod:by-fp:0123456789abcdef');
});

test('the same pair is re-checked once per window, a new pair at once', () => {
    const t0 = 1_000_000;
    assert.equal(moderation._shouldRecheckHeartbeatObservation('ip|a|8.8.8.8', t0), true);
    assert.equal(moderation._shouldRecheckHeartbeatObservation('ip|a|8.8.8.8', t0 + 20_000), false);
    assert.equal(moderation._shouldRecheckHeartbeatObservation('ip|a|1.1.1.1', t0 + 20_000), true, 'a new IP is not throttled');
    assert.equal(moderation._shouldRecheckHeartbeatObservation('ip|a|8.8.8.8', t0 + FIVE_MIN), true);
});

test('a heartbeat records a new IP and fingerprint, then skips the reads for an unchanged pair', async () => {
    const t0 = Date.now();
    await moderation.recordHeartbeatObservation(NAME, '8.8.8.8', '0123456789abcdef', t0);
    assert.equal((await kv.get<{ lastIp: string }>(`mod:ip-v2:${NAME}`))?.lastIp, '8.8.8.8');
    assert.equal((await kv.get<{ lastFp: string }>(`mod:fp:${NAME}`))?.lastFp, '0123456789abcdef');
    assert.deepEqual(await kv.get('mod:by-ip-v2:8.8.8.8'), [NAME]);

    const originalGet = kv.get.bind(kv);
    const reads: string[] = [];
    kv.get = (async (key: string) => { reads.push(key); return originalGet(key); }) as typeof kv.get;
    try {
        await moderation.recordHeartbeatObservation(NAME, '8.8.8.8', '0123456789abcdef', t0 + 20_000);
        assert.deepEqual(reads, [], 'an unchanged pair inside the window costs no reads');

        await moderation.recordHeartbeatObservation(NAME, '1.1.1.1', '0123456789abcdef', t0 + 40_000);
        assert.ok(reads.some((key) => key === `mod:ip-v2:${NAME}`), 'a new IP is checked on the beat it appears');
    } finally {
        kv.get = originalGet as typeof kv.get;
    }
    const forward = await kv.get<{ lastIp: string; ips: string[] }>(`mod:ip-v2:${NAME}`);
    assert.equal(forward?.lastIp, '1.1.1.1');
    assert.deepEqual(forward?.ips, ['1.1.1.1', '8.8.8.8']);
    assert.deepEqual(await kv.get('mod:by-ip-v2:1.1.1.1'), [NAME]);
});

test('the heartbeat uses the throttled recorder; sign-in paths still record directly', () => {
    const readApi = (file: string) => readFileSync(join(process.cwd(), 'api', file), 'utf8');
    const heartbeat = readApi('player/heartbeat.ts');
    assert.match(heartbeat, /void recordHeartbeatObservation\(identity\.name, clientIpFrom\(req\), clientFpFrom\(req\)\)/);
    assert.doesNotMatch(heartbeat, /recordClientIp\(|recordClientFingerprint\(/);
    const auth = readApi('player-auth.ts');
    assert.match(auth, /void recordClientIp\(name, clientIpFrom\(req\)\)/);
});
