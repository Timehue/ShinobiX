import assert from 'node:assert/strict';
import { before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('../_storage.js').kv;
let moderation: Pick<typeof import('./moderation.js'),
    'recordClientIp' | 'recordClientFingerprint' | 'MOD_LINKAGE_TTL_SECONDS'>;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    moderation = await import('./moderation.js');
});

const NINETY_DAYS = 90 * 24 * 60 * 60;

async function captureSets(run: () => Promise<void>): Promise<Map<string, { ex?: number } | undefined>> {
    const seen = new Map<string, { ex?: number } | undefined>();
    const originalSet = kv.set.bind(kv);
    kv.set = (async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        seen.set(key, options);
        return originalSet(key, value, options);
    }) as typeof kv.set;
    try {
        await run();
    } finally {
        kv.set = originalSet as typeof kv.set;
    }
    return seen;
}

test('the linkage TTL is 90 days', () => {
    assert.equal(moderation.MOD_LINKAGE_TTL_SECONDS, NINETY_DAYS);
});

test('IP linkage rows (forward and reverse) are written with a 90-day expiry', async () => {
    const name = `ttl-ip-${process.pid}`;
    await kv.del(`mod:ip-v2:${name}`, 'mod:by-ip-v2:8.8.4.4');
    const sets = await captureSets(() => moderation.recordClientIp(name, '8.8.4.4'));
    assert.equal(sets.get(`mod:ip-v2:${name}`)?.ex, NINETY_DAYS);
    assert.equal(sets.get('mod:by-ip-v2:8.8.4.4')?.ex, NINETY_DAYS);
    assert.ok(![...sets.keys()].some((key) => key.startsWith('mod:ip:') || key.startsWith('mod:by-ip:')),
        'legacy mod:ip / mod:by-ip rows get no new writes');
    await kv.del(`mod:ip-v2:${name}`, 'mod:by-ip-v2:8.8.4.4');
});

test('fingerprint linkage rows (forward and reverse) are written with a 90-day expiry', async () => {
    const name = `ttl-fp-${process.pid}`;
    const fp = 'fedcba9876543210';
    await kv.del(`mod:fp:${name}`, `mod:by-fp:${fp}`);
    const sets = await captureSets(() => moderation.recordClientFingerprint(name, fp));
    assert.equal(sets.get(`mod:fp:${name}`)?.ex, NINETY_DAYS);
    assert.equal(sets.get(`mod:by-fp:${fp}`)?.ex, NINETY_DAYS);
    await kv.del(`mod:fp:${name}`, `mod:by-fp:${fp}`);
});
