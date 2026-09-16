import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pet-terminal-recovery-test-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type Json = Record<string, unknown>;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let start: Handler;
const player = 'petterminalrecovery';
const requestId = 'petterminalrequest01';
const token = 'petterminaltoken00001';
const activeKey = `pet-encounter-active:${player}`;
const requestKey = `pet-encounter-request:${player}:${requestId}`;
const tokenKey = `pet-encounter:${player}:${token}`;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    start = (await import('./encounter-start.js')).default as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    onlineStore.remove(player);
});

after(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function post(id = requestId): Promise<{ status: number; body?: Json }> {
    const out: { status: number; body?: Json } = { status: 200 };
    const res = {
        setHeader: () => res,
        status: (status: number) => { out.status = status; return res; },
        json: (body: Json) => { out.body = body; return res; },
        end: () => res,
    };
    await start({
        method: 'POST', body: { playerName: player, requestId: id, sector: 65 },
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(player) },
        socket: { remoteAddress: '127.0.0.87' },
    } as never, res as never);
    return out;
}

async function seedTerminal(resolution: 'declined' | 'befriended' | 'expired' | 'explored-miss') {
    const mintedAt = Date.now();
    const hit = resolution !== 'explored-miss';
    const pet = { id: 'recovery-test-pet', name: 'Recovered Pet', level: 1, stats: { hp: 10 } };
    const authority = { playerName: player, requestId, sector: 65, mintedAt, ...(hit ? { token, pet } : {}) };
    const receipt = {
        ...authority, version: 1, day: new Date(mintedAt).toISOString().slice(0, 10),
        resolvedAt: mintedAt, resolution,
    };
    await kv.set(activeKey, { ...authority, outcome: hit ? 'hit' : 'miss' });
    await kv.set(requestKey, receipt);
    if (hit) await kv.set(tokenKey, authority);
    return receipt;
}

describe('terminal wild-pet recovery cleanup', { concurrency: false }, () => {
    for (const resolution of ['declined', 'befriended', 'expired', 'explored-miss'] as const) {
        it(`cleans interrupted ${resolution} authority and admits the next fresh search`, async () => {
            const receipt = await seedTerminal(resolution);
            const recovered = await post('newpetrequest001');
            assert.equal(recovered.status, 200);
            assert.equal(recovered.body?.requestId, requestId);
            assert.equal(recovered.body?.resolved, true);
            assert.equal(recovered.body?.resolution, resolution);
            assert.equal(recovered.body?.pet, null);
            assert.equal(recovered.body?.token, undefined);
            assert.equal(await kv.get(activeKey), null);
            assert.equal(await kv.get(tokenKey), null);
            assert.deepEqual(await kv.get(requestKey), receipt, 'terminal history is not rewritten as unresolved');

            const replay = await post();
            assert.equal(replay.body?.resolved, true);
            assert.equal(await kv.get(activeKey), null, 'an exact terminal replay stays terminal');
            assert.equal(await kv.get(tokenKey), null);

            onlineStore.upsert({ name: player, sector: 65, character: { level: 50 }, tile: 5 });
            const fresh = await post('newpetrequest001');
            assert.equal(fresh.status, 200);
            assert.equal(fresh.body?.requestId, 'newpetrequest001');
            assert.equal(fresh.body?.replayed, false);
            assert.equal(fresh.body?.resolved, undefined);
        });
    }

    it('retries an interrupted pointer deletion without recreating a spent token', async () => {
        const receipt = await seedTerminal('declined');
        const originalDel = kv.del;
        kv.del = async (...keys: string[]) => {
            if (keys.includes(activeKey)) throw new Error('simulated pointer cleanup outage');
            return originalDel.apply(kv, keys);
        };
        let failed;
        try {
            failed = await post();
        } finally {
            kv.del = originalDel;
        }
        assert.equal(failed.status, 500);
        assert.ok(await kv.get(activeKey));
        assert.equal(await kv.get(tokenKey), null);
        assert.deepEqual(await kv.get(requestKey), receipt);

        const recovered = await post();
        assert.equal(recovered.status, 200);
        assert.equal(recovered.body?.resolved, true);
        assert.equal(await kv.get(activeKey), null);
        assert.equal(await kv.get(tokenKey), null);
        assert.deepEqual(await kv.get(requestKey), receipt);
    });
});
