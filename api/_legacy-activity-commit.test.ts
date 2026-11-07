import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'legacy-activity-commit-test-secret';
process.env.ENABLE_LEGACY = '1';

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('./_storage.js').kv;
let token: typeof import('./_auth.js').issuePlayerToken;
let claim: Handler, forge: Handler, rift: Handler;
let sealGatherFind: typeof import('./world/_gather.js').sealGatherFind;
let WORLD_GEO_VERSION: number;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ issuePlayerToken: token } = await import('./_auth.js'));
    ({ sealGatherFind } = await import('./world/_gather.js'));
    ({ WORLD_GEO_VERSION } = await import('../shared/sector-geo.js'));
    claim = (await import('./world/claim-gather.js')).default as unknown as Handler;
    forge = (await import('./craft/forge.js')).default as unknown as Handler;
    rift = (await import('./sector/rift-quest.js')).default as unknown as Handler;
});
beforeEach(() => { process.env.ENABLE_LEGACY = '1'; });

async function seed(player: string, patch: Json = {}, level = 50) {
    await kv.set(`save:${player}`, { _saveVersion: 1, _saveAt: Date.now(), character: {
        name: player, level, village: 'Ashen Leaf', hp: 100, maxHp: 100,
        chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        ryo: 5000, inventory: [], itemStacks: [], ...patch,
    } });
    await kv.set(`legacy:stats:${player}`, { bootstrappedAt: Date.now(), gatheringClaims: 0 });
}
async function post(handler: Handler, player: string, body: Json) {
    const out = { status: 200, body: {} as Json };
    const res = { setHeader: () => res, status: (status: number) => { out.status = status; return res; },
        json: (body: Json) => { out.body = body; return res; }, end: () => res };
    await handler({ method: 'POST', body: { playerName: player, ...body }, headers: { 'x-player-token': token(player) },
        socket: { remoteAddress: '127.8.9.10' } } as never, res as never);
    return out;
}
const choice = { findId: 'legacy-find-00001', sector: 33, common: 'gather-iron-sand', takeTrace: false };
const stats = (player: string) => kv.get<Json>(`legacy:stats:${player}`);
async function gatherSeed(player: string, level = 50) {
    await seed(player, { pendingGatherFinds: [sealGatherFind(choice.findId, 33, () => 0.9)!] }, level);
}

test('actual gathering at levels 50, 70, 90 and 99 credits once and ignores forged progress', async () => {
    for (const level of [50, 70, 90, 99]) {
        const player = `legacygather${level}`;
        await gatherSeed(player, level);
        const first = await post(claim, player, { ...choice, gatheringClaims: 999999 });
        assert.equal(first.status, 200, JSON.stringify(first.body));
        assert.equal((await stats(player))?.gatheringClaims, 1);
        const replay = await post(claim, player, choice);
        assert.equal(replay.body.replayed, true);
        assert.equal((await stats(player))?.gatheringClaims, 1);
        assert.equal(replay.body._saveVersion, first.body._saveVersion);
    }
});

test('a failed stats CAS cannot consume a find or grant its reward; retry completes both', async () => {
    const player = 'legacygathercas'; await gatherSeed(player);
    const before = await kv.get(`save:${player}`), original = kv.compareSetMany!;
    kv.compareSetMany = async ops => ops.some(op => op.key === `legacy:stats:${player}`) ? false : original.call(kv, ops);
    try { assert.equal((await post(claim, player, choice)).status, 500); }
    finally { kv.compareSetMany = original; }
    assert.deepEqual(await kv.get(`save:${player}`), before);
    assert.equal((await stats(player))?.gatheringClaims, 0);
    assert.equal((await post(claim, player, choice)).status, 200);
    assert.equal((await stats(player))?.gatheringClaims, 1);
});

test('concurrent legacy progress is kept, and the claim still lands on the moved row', async () => {
    const player = 'legacygatherrace'; await gatherSeed(player);
    const original = kv.compareSetMany!; let raced = false, attempts = 0;
    kv.compareSetMany = async ops => {
        if (ops.some(op => op.key === `legacy:stats:${player}`)) attempts++;
        if (!raced && ops.some(op => op.key === `legacy:stats:${player}`)) {
            raced = true;
            await kv.set(`legacy:stats:${player}`, { ...await stats(player), healingDone: 500 });
        }
        return original.call(kv, ops);
    };
    let first;
    try { first = await post(claim, player, choice); }
    finally { kv.compareSetMany = original; }
    // Before 2026-11-04 this answered 500 and the player had to claim again.
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(attempts, 2, 'one refusal, then one rebased commit');
    assert.equal((await stats(player))?.healingDone, 500);
    assert.equal((await stats(player))?.gatheringClaims, 1);
    assert.equal((await post(claim, player, choice)).body.replayed, true);
    assert.equal((await stats(player))?.gatheringClaims, 1);
});

test('a stats row that keeps moving is rebased only once, then refused with nothing spent', async () => {
    const player = 'legacygatherchurn'; await gatherSeed(player);
    const before = await kv.get(`save:${player}`), original = kv.compareSetMany!; let bumps = 0;
    kv.compareSetMany = async ops => {
        if (ops.some(op => op.key === `legacy:stats:${player}`)) {
            await kv.set(`legacy:stats:${player}`, { ...await stats(player), healingDone: ++bumps });
        }
        return original.call(kv, ops);
    };
    try { assert.equal((await post(claim, player, choice)).status, 500); }
    finally { kv.compareSetMany = original; }
    assert.equal(bumps, 2);
    assert.deepEqual(await kv.get(`save:${player}`), before);
    assert.equal((await stats(player))?.gatheringClaims, 0);
});

test('lost atomic-write acknowledgement preserves both reward and exactly one deed', async () => {
    const player = 'legacygatherlost'; await gatherSeed(player);
    const original = kv.compareSetMany!; let lost = false;
    kv.compareSetMany = async ops => {
        const done = await original.call(kv, ops);
        if (done && !lost && ops.some(op => op.key === `legacy:stats:${player}`)) { lost = true; throw new Error('test lost acknowledgement'); }
        return done;
    };
    try { await post(claim, player, choice); }
    finally { kv.compareSetMany = original; }
    assert.equal((await post(claim, player, choice)).body.replayed, true);
    assert.equal((await stats(player))?.gatheringClaims, 1);
});

test('an older combat writer cannot overwrite a concurrent atomic gathering deed', async () => {
    const player = 'legacycombatgatherrace'; await gatherSeed(player);
    const { bumpLegacyStats } = await import('./_legacy-track.js');
    const original = kv.compareSet; let raced = false;
    kv.compareSet = async (key, expected, next, options) => {
        if (!raced && key === `legacy:stats:${player}` && (next as Json).missionCompletions === 1) {
            raced = true;
            assert.equal((await post(claim, player, choice)).status, 200);
        }
        return original.call(kv, key, expected, next, options);
    };
    try { assert.equal(await bumpLegacyStats(player, { missionCompletions: 1 }, { receiptId: 'combat-race-proof' }), false); }
    finally { kv.compareSet = original; }
    assert.equal((await stats(player))?.gatheringClaims, 1);
    assert.equal(await bumpLegacyStats(player, { missionCompletions: 1 }, { receiptId: 'combat-race-proof' }), true);
    assert.equal((await stats(player))?.missionCompletions, 1);
    assert.equal((await stats(player))?.gatheringClaims, 1);
});

test('forging real items credits committed output once; refused crafts grant no deed', async () => {
    const player = 'legacyforge';
    // Exactly one batch of the recipe's lead material in each row (Common Iron
    // Sand, Heartwood Bark, Binding Fiber), read from the live recipe so a cost
    // change does not leave the seed short.
    const { SUPPLY_CRAFT_RECIPES } = await import('../shared/crafting-recipes.js');
    const rows = SUPPLY_CRAFT_RECIPES['thrown-shuriken'].ingredients;
    assert.deepEqual(rows.map(row => row.ids[0]), ['gather-iron-sand', 'gather-heartwood-bark', 'gather-binding-fiber']);
    await seed(player, { itemStacks: rows.map(row => ({ itemId: row.ids[0], count: row.count })) });
    const body = { requestId: 'legacy-forge-0001', kind: 'supply', recipeId: 'thrown-shuriken', quantity: 1,
        materials: rows.map(row => ({ [row.ids[0]]: row.count })) };
    assert.equal((await post(forge, player, { ...body, materials: [] })).status, 409);
    assert.equal((await stats(player))?.craftsCompleted, undefined);
    const first = await post(forge, player, body); assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal((await stats(player))?.craftsCompleted, 3);
    assert.equal((await post(forge, player, body)).body.replayed, true);
    assert.equal((await stats(player))?.craftsCompleted, 3);
});

test('a verified pre-100 Rift claim commits its deed with the reward and seal consumption', async () => {
    const player = 'legacyrift', at = Date.now() - 60000, runToken = 'legacy-rift-run-token';
    const seal = { id: 'rift-legacy-echo', targetSector: 12, baseline: 0, at, geoV: WORLD_GEO_VERSION, runToken };
    await seed(player, { activeRiftQuest: { id: seal.id },
        riftQuestBossReceipt: { riftId: seal.id, runToken, combatRunId: 'legacy-rift-combat', acceptedAt: at, clearedAt: at + 5000 } });
    const saved = (await kv.get<Json>(`save:${player}`))!;
    await kv.set(`save:${player}`, { ...saved, activeRiftQuestSeal: seal });
    await kv.set(`rift-quest:${player}`, seal);
    const body = { action: 'complete', riftId: seal.id };
    const first = await post(rift, player, body); assert.equal(first.body.ok, true, JSON.stringify(first.body));
    assert.equal((await stats(player))?.riftQuests, 1);
    assert.equal((await post(rift, player, body)).body.reason, 'none');
    assert.equal((await stats(player))?.riftQuests, 1);
});

test('feature-off keeps activity rewards and performs no legacy writes', async () => {
    const player = 'legacygatheroff'; await gatherSeed(player); process.env.ENABLE_LEGACY = '0';
    const before = await stats(player);
    assert.equal((await post(claim, player, choice)).status, 200);
    assert.deepEqual(await stats(player), before);
});
