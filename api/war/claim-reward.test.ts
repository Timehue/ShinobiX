import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'war-legacy-reward-test-secret-32-bytes';
process.env.ENABLE_LEGACY = '1';

const VILLAGE = 'Moonshadow Village';
const PLAYER = 'crowshinobi';
const WAR_ID = 'ashenleafvillage-vs-moonshadowvillage';
const CRATE_ID = `war-crate-${WAR_ID}-g2`;
const LEGACY_KEY = `legacy:stats:${PLAYER}`;
type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let token: typeof import('../_auth.js').issuePlayerToken;
let reward: Handler;
let crate: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken: token } = await import('../_auth.js'));
    reward = (await import('./claim-reward.js')).default as unknown as Handler;
    crate = (await import('../village/claim-war-crate.js')).default as unknown as Handler;
});
beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set(`save:${PLAYER}`, { _saveVersion: 3, character: {
        name: 'Crow Shinobi', village: VILLAGE, level: 20, profession: 'vanguard', inventory: [],
        claimedWarCrateIds: [], ryo: 0, honorSeals: 0, boneCharms: 0, fateShards: 0,
    } });
    await kv.set(`world:war:${WAR_ID}`, {
        id: WAR_ID, declarationGeneration: 2, villages: ['Ashen Leaf Village', VILLAGE],
        endedAt: Date.now() - 1000, winnerVillage: VILLAGE, warCrateId: CRATE_ID,
        mvpByVillage: { [VILLAGE]: PLAYER },
        contributions: { [PLAYER]: { damage: 60, side: VILLAGE, name: PLAYER } },
    });
});
after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.ENABLE_LEGACY;
});

async function call(handler: Handler, body: Record<string, unknown>) {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = {
        setHeader() { return res; }, status(code: number) { out.status = code; return res; },
        json(body: Record<string, any>) { out.body = body; return res; }, end() { return res; },
    };
    await handler({ method: 'POST', body: { playerName: PLAYER, ...body },
        headers: { 'x-player-token': token(PLAYER) }, socket: { remoteAddress: '127.0.0.9' } } as never, res as never);
    return out;
}
const claimReward = () => call(reward, { kind: 'village', warId: WAR_ID });
const claimCrate = () => call(crate, { warCrateId: CRATE_ID });
async function assertCounters() {
    const legacy = await kv.get<any>(LEGACY_KEY);
    const character = (await kv.get<any>(`save:${PLAYER}`)).character;
    assert.deepEqual([legacy.warsWon, legacy.warMvps, character.warsWon, character.warMvpCount], [1, 1, 1, 1]);
    assert.equal(character.inventory.filter((id: string) => id === 'legendary-war-crate').length, 2);
    assert.equal(character.ryo, 10000);
}

describe('combined village reward Legacy delivery', { concurrency: false }, () => {
    it('first-touch bootstrap and both claim routes record one win and one MVP', async () => {
        const first = await claimReward();
        assert.equal(first.status, 200, JSON.stringify(first.body));
        assert.equal(first.body.crates, 2);
        await assertCounters();
        assert.equal((await claimCrate()).body.granted, false);
        assert.equal((await claimReward()).body.granted, false);
        await assertCounters();
    });
    it('repairs an interrupted Legacy write without another payout or save-version bump', async (t) => {
        await kv.set(LEGACY_KEY, { updatedAt: Date.now(), warsWon: 0, warMvps: 0 });
        const set = kv.set.bind(kv);
        t.mock.method(kv, 'set', async (...args: Parameters<typeof set>) => {
            if (args[0] === LEGACY_KEY) throw new Error('injected Legacy write failure');
            return set(...args);
        });
        const first = await claimReward();
        assert.equal(first.status, 503);
        assert.equal(first.body.code, 'legacy-delivery-pending');
        const version = (await kv.get<any>(`save:${PLAYER}`))._saveVersion;
        assert.equal(first.body._saveVersion, version);
        t.mock.restoreAll();
        const repaired = await claimReward();
        assert.equal(repaired.status, 200, JSON.stringify(repaired.body));
        assert.equal(repaired.body.granted, false);
        assert.equal((await kv.get<any>(`save:${PLAYER}`))._saveVersion, version);
        await assertCounters();
        assert.equal((await claimCrate()).body.granted, false);
        await assertCounters();
    });
});
