import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { validateHollowGateFloorManifest } from './_floor-manifest.js';
import { hollowGateRunKey, type HollowGateRunToken } from './_run-token.js';
import { cardClashAiTokenKey } from '../card-clash/_ai-reward.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let resetRateLimits: () => void;
const handlers: Record<string, Handler> = {};
const PLAYER = 'floorprojectiondiver', TOKEN = 'floor-projection-token';
const runKey = hollowGateRunKey(PLAYER, TOKEN), saveKey = `save:${PLAYER}`;
before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    for (const name of ['descend', 'resume', 'floor-seal', 'combat-start', 'card-settle', 'step']) {
        handlers[name] = (await import(`./${name}.js`)).default as Handler;
    }
});
beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    resetRateLimits();
});
async function call(name: string, body: Record<string, unknown> = {}) {
    const reply = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader: () => res, status: (status: number) => { reply.status = status; return res; },
        json: (data: Record<string, unknown>) => { reply.body = data; return res; }, end: () => res };
    await handlers[name]({ method: 'POST', body: { playerName: PLAYER, token: TOKEN, ...body }, query: {},
        headers: { 'x-player-name': PLAYER, 'x-player-token': issuePlayerToken(PLAYER)! },
        socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
    return reply;
}
function board(floor: number) {
    const tiles = Array.from({ length: 165 }, () => ({ kind: 'empty', terrain: 'room_floor' }));
    let index = 20;
    for (const [kind, count] of [
        ['battle', 4 + Math.min(5, floor)], ['elite', 1 + Math.floor(floor / 2)], ['trap', 1], ['chest', 3],
        ['shard_vein', 1 + Math.floor(floor / 2)], ['locked', 1], ['shrine', 1], ['story', 1], ['npc', 1],
    ] as const) for (let n = 0; n < count; n++) tiles[index++].kind = kind;
    tiles[136].kind = 'exit'; tiles[148].kind = 'descend';
    const validated = validateHollowGateFloorManifest({ floor, finalFloor: false, width: 15, height: 11,
        playerX: 1, playerY: 1, tiles });
    assert.ok(validated.ok);
    return { tiles, manifest: validated.manifest };
}
async function seed(floor = 1, savedFloor = floor, savedPatch: Record<string, unknown> = {}) {
    const run: HollowGateRunToken = { playerName: PLAYER, mintedAt: Date.now(), floorDepth: 5,
        currentFloor: floor, seed: 'projection-seed', entryCurrencies: { ryo: 400 }, entryItems: {},
        offeredAugmentIds: ['keen-edge'], chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1,
        variantId: 'rift-hollow-stalker', floorManifests: { '1': board(1).manifest, '2': board(2).manifest },
        position: floor === 1 ? { x: 13, y: 9 } : { x: 3, y: 1 }, torch: 6, threat: 0,
        resolvedEncounterIds: [], resolvedEventIds: [], stepVersion: 0 };
    await kv.set(runKey, run);
    await kv.set(saveKey, { _saveVersion: 1, character: { name: PLAYER, level: 30, hp: 400,
        maxHp: 500, ryo: 400, auraDust: 0, itemStacks: [],
        lastHollowGateStart: { requestId: 'floor-start-0001', token: TOKEN, at: Date.now() },
        hollowGateRun: { runToken: TOKEN, serverSeed: run.seed, floor: savedFloor, ...savedPatch } } });
    return run;
}
const saved = () => kv.get<Record<string, any>>(saveKey);
async function pendingHound() {
    const run = (await kv.get<HollowGateRunToken>(runKey))!;
    const nodeId = 'floor:2:ambush:threat-v50';
    await kv.set(runKey, { ...run, pendingAmbush: { nodeId, kind: 'ambush' }, threat: 100 });
    return call('combat-start', { floor: 2, kind: 'ambush', nodeId, mode: 'pve' });
}
test('descent commits the saved floor before any browser autosave; replay cannot advance again', async () => {
    await seed();
    const result = await call('descend', { fromFloor: 1 });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal((await saved())!.character.hollowGateRun.floor, 2);
    assert.equal(result.body._saveVersion, (await saved())!._saveVersion);
    assert.equal(result.body.character.hollowGateRun.floor, 2);
    assert.equal(result.body.character.hollowGateRun.torch, 10);
    assert.equal((await kv.get<HollowGateRunToken>(runKey))!.currentFloor, 2);
    assert.equal((await call('descend', { fromFloor: 1 })).status, 200);
    assert.equal((await kv.get<HollowGateRunToken>(runKey))!.currentFloor, 2);
    const fight = await pendingHound();
    assert.equal(fight.status, 200, JSON.stringify(fight.body));
});
for (const winner of ['player', 'opponent', 'draw']) test(`old floor projection survives card ${winner} and next PvE ambush resumes safely`, async () => {
    const run = await seed(2, 1);
    const nodeId = 'floor:2:ambush:threat-v25', matchId = randomUUID();
    await kv.set(runKey, { ...run, pendingAmbush: { nodeId, kind: 'card' }, cardAmbushMatchId: matchId, threat: 100 });
    await kv.set(cardClashAiTokenKey(matchId), { matchId, playerName: PLAYER, status: 'done', winner,
        settledAt: Date.now(), settlementMode: 'external',
        hollowGateCard: { tokenDigest: createHash('sha256').update(TOKEN).digest('hex'), nodeId } });
    const settled = await call('card-settle', { matchId });
    assert.equal(settled.status, 200, JSON.stringify(settled.body));
    const hp = winner === 'player' ? 400 : 235; // 33% of the 500 max HP, not current HP.
    assert.equal((await saved())!.character.hp, hp);
    const fight = await pendingHound();
    assert.equal(fight.status, 200, JSON.stringify(fight.body));
    assert.equal((await saved())!.character.hp, hp, 'projection recovery grants no healing');
    assert.equal((await saved())!.character.hollowGateRun.floor, 2);
});

test('reload reads sealed floor, path and pending encounter; combat repairs the old projection once', async () => {
    const oldTiles = board(1).tiles;
    const run = await seed(2, 1, { tiles: oldTiles, playerX: 13, playerY: 9 });
    const nodeId = 'floor:2:ambush:threat-v50';
    await kv.set(runKey, { ...run, pendingAmbush: { nodeId, kind: 'ambush' }, threat: 100 });
    const resume = await call('resume');
    assert.equal(resume.status, 200);
    assert.equal(resume.body.run.floor, 2);
    assert.deepEqual(resume.body.run.position, { x: 3, y: 1 });
    assert.deepEqual(resume.body.run.pendingAmbush, { nodeId, kind: 'ambush' });
    const before = (await saved())!;
    const fight = await call('combat-start', { floor: 2, kind: 'ambush', nodeId });
    assert.equal(fight.status, 200, JSON.stringify(fight.body));
    const after = (await saved())!;
    assert.equal(after._saveVersion, before._saveVersion + 1);
    assert.equal(after.character.hollowGateRun.floor, 2);
    assert.equal(after.character.hollowGateRun.tiles, undefined, 'discard the obsolete drawing');
    for (const key of ['hp', 'ryo', 'auraDust', 'itemStacks', 'lastHollowGateStart']) {
        assert.deepEqual(after.character[key], before.character[key], key);
    }
    const replay = await call('combat-start', { floor: 2, kind: 'ambush', nodeId });
    assert.equal(replay.body.runId, fight.body.runId);
    assert.equal((await saved())!._saveVersion, after._saveVersion);
});

for (const [label, floor, patch] of [
    ['future floor', 3, {}], ['zero floor', 0, {}], ['fractional floor', 1.5, {}],
    ['wrong seed', 1, { serverSeed: 'other' }], ['wrong token', 1, { runToken: 'other' }],
] as const) test(`projection repair refuses ${label} without changing save or creating combat`, async () => {
    await seed(2, floor, patch);
    const before = await saved();
    const result = await pendingHound();
    assert.equal(result.status, 409);
    assert.deepEqual(await saved(), before);
    assert.equal((await kv.get<HollowGateRunToken>(runKey))!.activeEncounter, undefined);
});

test('interrupted descent repairs its committed save proof on replay without duplicating torch refill', async () => {
    await seed();
    const original = kv.compareSet.bind(kv);
    let fail = true;
    kv.compareSet = (async (...args: Parameters<typeof kv.compareSet>) => {
        if (args[0] === runKey && fail) { fail = false; throw new Error('simulated run-write interruption'); }
        return original(...args);
    }) as typeof kv.compareSet;
    try {
        assert.equal((await call('descend', { fromFloor: 1 })).status, 500);
    } finally { kv.compareSet = original; }
    assert.equal((await saved())!.character.hollowGateRun.floor, 2);
    const retried = await call('descend', { fromFloor: 1 });
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    const run = (await kv.get<HollowGateRunToken>(runKey))!;
    assert.equal(run.currentFloor, 2);
    assert.equal(run.torch, 10);
    assert.equal(run.threat, 0);
    assert.equal((await saved())!.character.hp, 400);
});

test('concurrent staircase requests advance once; generic saves cannot restore the obsolete board', async () => {
    await seed();
    const replies = await Promise.all([call('descend', { fromFloor: 1 }), call('descend', { fromFloor: 1 })]);
    assert.ok(replies.some(reply => reply.status === 200));
    assert.equal((await call('descend', { fromFloor: 1 })).status, 200);
    const record = (await saved())!;
    const { sanitizeChallengeProgress } = await import('../save/_sanitize-challenges.js');
    const incoming = { ...record.character, hollowGateRun: { ...record.character.hollowGateRun,
        floor: 1, tiles: board(1).tiles, playerX: 13, playerY: 9 } };
    sanitizeChallengeProgress(incoming, record.character);
    assert.deepEqual(incoming.hollowGateRun, record.character.hollowGateRun);
    assert.equal((await kv.get<HollowGateRunToken>(runKey))!.currentFloor, 2);
    assert.equal((await saved())!.character.hollowGateRun.floor, 2);
});

test('canonical-equivalent player display casing does not block projection recovery', async () => {
    await seed(2, 1);
    const record = (await saved())!;
    await kv.set(saveKey, { ...record, character: { ...record.character, name: 'FloorProjectionDiver' } });
    const fight = await pendingHound();
    assert.equal(fight.status, 200, JSON.stringify(fight.body));
    assert.equal((await saved())!.character.hollowGateRun.floor, 2);
});

test('lost save acknowledgement and immediate readback recover through resume without a second descent', async (t) => {
    await seed();
    const compare = kv.compareSet.bind(kv), get = kv.get.bind(kv);
    let committed = false, failRead = false;
    t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
        const result = await compare(...args);
        if (args[0] === saveKey && result && !committed) {
            committed = true; failRead = true; throw new Error('lost-save-ack');
        }
        return result;
    });
    t.mock.method(kv, 'get', async (key: string) => {
        if (key === saveKey && failRead) { failRead = false; throw new Error('lost-immediate-readback'); }
        return get(key);
    });
    const interrupted = await call('descend', { fromFloor: 1 });
    t.mock.restoreAll();
    assert.equal(interrupted.status, 500);
    assert.equal(committed, true);
    assert.equal((await saved())!.character.hollowGateRun.floor, 2);
    assert.equal((await kv.get<HollowGateRunToken>(runKey))!.currentFloor, 1);
    const resumed = await call('resume');
    assert.equal(resumed.body.run.floor, 2);
    assert.equal((await call('descend', { fromFloor: 1 })).status, 200);
    assert.equal((await saved())!._saveVersion, 2);
    assert.equal((await saved())!.character.hp, 400);
    assert.equal((await kv.get<HollowGateRunToken>(runKey))!.torch, 10);
});

test('lost run acknowledgement is read back and a replay cannot refill torch twice', async (t) => {
    await seed();
    const compare = kv.compareSet.bind(kv);
    let lost = false;
    t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
        const result = await compare(...args);
        if (args[0] === runKey && result && !lost) { lost = true; throw new Error('lost-run-ack'); }
        return result;
    });
    const descended = await call('descend', { fromFloor: 1 });
    t.mock.restoreAll();
    assert.equal(descended.status, 200, JSON.stringify(descended.body));
    assert.equal(lost, true);
    assert.equal((await call('descend', { fromFloor: 1 })).status, 200);
    assert.equal((await saved())!._saveVersion, 2);
    assert.equal((await kv.get<HollowGateRunToken>(runKey))!.torch, 10);
});
