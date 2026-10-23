import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'shrine-reads-tests-secret';

// The golden war shrine is walked one tile per request, polled every 5 s, and
// every request takes the war-wide lock. Each one used to read the caller's
// whole save and, two or three times over, the whole save of every player in
// the room: megabytes per step under a lock that all participants share. Only
// the save facts (name, village, level, the incapacitation fields) decide a
// shrine request, so only those may be read.
const A = 'Ashen Leaf Village', B = 'Moonshadow Village', id = 'ashenleafvillage-vs-moonshadowvillage';
type Kv = typeof import('../_storage.js').kv;
let kv: Kv;
let endpoint: (req: unknown, res: unknown) => Promise<unknown>;
let token: typeof import('../_auth.js').issuePlayerToken;
let presence: typeof import('../_realtime/online-store.js').onlineStore;
let projectKvValue: typeof import('../_storage-projection.js').projectKvValue;
const wholeSaveReads: string[] = [], projectedSaveReads: string[] = [];
before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ projectKvValue } = await import('../_storage-projection.js'));
    endpoint = (await import('./war-campaign.js')).default as never;
    ({ issuePlayerToken: token } = await import('../_auth.js'));
    ({ onlineStore: presence } = await import('../_realtime/online-store.js'));
    const store = kv as unknown as Record<string, unknown>;
    const get = kv.get.bind(kv), mget = kv.mget.bind(kv);
    store.get = async (key: string) => { if (key.startsWith('save:')) wholeSaveReads.push(key); return get(key); };
    store.mget = async (...keys: string[]) => { wholeSaveReads.push(...keys.filter(key => key.startsWith('save:'))); return mget(...keys); };
    // Postgres projects inside the database; model that for the memory store.
    store.mgetProjected = async (keys: string[], projection: Parameters<typeof projectKvValue>[1]) => {
        projectedSaveReads.push(...keys.filter(key => key.startsWith('save:')));
        return (await mget(...keys)).map(value => projectKvValue(value, projection));
    };
});
beforeEach(async () => {
    const keys = await kv.keys('*'); if (keys.length) await kv.del(...keys);
    (await import('../_ratelimit.js')).__resetRateLimitsForTest();
    const { leaveShrineRoom } = await import('../_village-war-shrine-presence.js');
    for (const name of ['alice', 'bob', 'cara']) { presence.remove(name); leaveShrineRoom(name); }
    (await import('../_village-war-shrine-closing.js')).resetShrineClosingTimersForTests();
});
let counter = 0;
async function call(player: string, body: Record<string, unknown>) {
    let status = 200; let data: any;
    const res = { setHeader() {}, status(n: number) { status = n; return this; }, json(b: unknown) { data = b; return this; }, end() {} };
    const ip = `10.97.0.${++counter}`;
    await endpoint({ method: 'POST', body: { warId: id, ...body }, headers: { 'x-player-token': token(player), 'x-forwarded-for': ip }, query: {}, socket: { remoteAddress: ip } }, res);
    return { status, data };
}
describe('golden war shrine save reads', { concurrency: false }, () => {
    it('enters, polls, steps and leaves on save facts alone, and still sees every eligible player', async () => {
        const { createVillageCampaign } = await import('../_village-war-campaign.js');
        const startsAt = Date.now() - 3 * 3_600_000, campaign = createVillageCampaign([A, B], startsAt, 47);
        const objective = campaign.shrine[0];
        objective.opensAt = Date.now() - 60_000; objective.closesAt = Date.now() + 3_600_000; objective.sector = 47;
        await kv.set(`world:war:${id}`, { id, villages: [A, B], startedAt: startsAt, updatedAt: startsAt, declarationGeneration: 1,
            hp: { [A]: 5000, [B]: 5000 }, warGroundSector: 47, warGroundHp: 1000, campaign, contributions: {} });
        const bulk = Array.from({ length: 50 }, (_, i) => ({ id: `item-${i}` }));
        await kv.set('save:alice', { character: { name: 'Alice', village: A, level: 100, hp: 1000, inventory: bulk } });
        await kv.set('save:bob', { character: { name: 'Bob', village: B, level: 100, hp: 1000, inventory: bulk } });
        // Hospitalised: present in the sector, never counted in the room.
        await kv.set('save:cara', { character: { name: 'Cara', village: A, level: 100, hp: 0, inventory: bulk } });
        for (const [name, village] of [['alice', A], ['bob', B], ['cara', A]] as const) presence.upsert({ name, sector: 47, character: { level: 100, village } });
        wholeSaveReads.length = 0; projectedSaveReads.length = 0;
        const objectiveId = objective.id;
        assert.equal((await call('alice', { action: 'shrine-enter', objectiveId })).status, 200);
        assert.equal((await call('bob', { action: 'shrine-enter', objectiveId })).status, 200);
        assert.equal((await call('cara', { action: 'shrine-enter', objectiveId })).status, 409, 'an incapacitated player is refused on the projected facts');
        const step = await call('alice', { action: 'shrine-step', objectiveId, tile: 114 });
        assert.equal(step.status, 200, JSON.stringify(step.data));
        assert.deepEqual(step.data.room.players.map((p: { name: string; displayName: string; village: string }) => [p.name, p.displayName, p.village]),
            [['alice', 'Alice', A], ['bob', 'Bob', B]]);
        assert.equal(step.data.room.players[0].tile, 114);
        const state = await call('bob', { action: 'shrine-state', objectiveId });
        assert.equal(state.status, 200); assert.equal(state.data.room.players.length, 2);
        assert.equal((await call('alice', { action: 'shrine-leave', objectiveId })).status, 200);
        assert.deepEqual(wholeSaveReads, [], 'a shrine request read a whole save');
        assert.ok(projectedSaveReads.includes('save:alice') && projectedSaveReads.includes('save:bob'));
    });
    it('steps without the war lock or a war-row write, so a full room never refuses a step as busy', async () => {
        const { createVillageCampaign } = await import('../_village-war-campaign.js');
        const startsAt = Date.now() - 3 * 3_600_000, campaign = createVillageCampaign([A, B], startsAt, 47);
        const objective = campaign.shrine[0];
        objective.opensAt = Date.now() - 60_000; objective.closesAt = Date.now() + 3_600_000; objective.sector = 47;
        await kv.set(`world:war:${id}`, { id, villages: [A, B], startedAt: startsAt, updatedAt: startsAt, declarationGeneration: 1,
            hp: { [A]: 5000, [B]: 5000 }, warGroundSector: 47, warGroundHp: 1000, campaign, contributions: {} });
        const names = Array.from({ length: 10 }, (_, i) => `walker${i}`);
        for (const [i, name] of names.entries()) {
            const village = i < 5 ? A : B;
            await kv.set(`save:${name}`, { character: { name, village, level: 100, hp: 1000 } });
            presence.upsert({ name, sector: 47, character: { level: 100, village } });
            assert.equal((await call(name, { action: 'shrine-enter', objectiveId: objective.id })).status, 200);
        }
        const before = await kv.get(`world:war:${id}`);
        const store = kv as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>, touched: string[] = [];
        const originals = new Map<string, (...args: unknown[]) => Promise<unknown>>();
        for (const method of ['set', 'compareSet', 'compareSetMany', 'del', 'delIfEqual']) {
            const original = store[method]; if (typeof original !== 'function') continue;
            originals.set(method, original);
            store[method] = async (...args: unknown[]) => {
                const keys = method === 'compareSetMany' ? JSON.stringify(args[0]) : String(args[0]);
                if (keys.includes('world:war:')) touched.push(`${method} ${keys.slice(0, 80)}`);
                return original.apply(kv, args);
            };
        }
        try {
            // Five steps for each of ten players, all at once.
            const results = await Promise.all(names.map(async name => {
                const statuses: number[] = [];
                for (const tile of [114, 115, 116, 117, 118]) statuses.push((await call(name, { action: 'shrine-step', objectiveId: objective.id, tile })).status);
                return statuses;
            }));
            assert.deepEqual(results.flat().filter(status => status !== 200), [], 'a concurrent step was refused');
        } finally { for (const [method, original] of originals) store[method] = original; }
        assert.deepEqual(touched, [], 'a step took the war lock or wrote the war row');
        assert.deepEqual(await kv.get(`world:war:${id}`), before);
        const state = await call('walker0', { action: 'shrine-state', objectiveId: objective.id });
        assert.equal(state.status, 200);
        assert.deepEqual(state.data.room.players.map((p: { tile: number }) => p.tile), names.map(() => 118), 'every step landed in the room');
    });
});
