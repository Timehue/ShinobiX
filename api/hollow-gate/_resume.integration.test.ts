import { createHash, randomBytes } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { hollowGateMarkVisited, validateHollowGateFloorManifest } from './_floor-manifest.js';
import { hollowGateCombatBindingKey } from './_combat-session.js';
import { hollowGateRunKey, type HollowGateRunToken } from './_run-token.js';

// A reload mid-run drops the drawn board: the save keeps only the server's
// projection of the run. /api/hollow-gate/resume hands the browser the sealed
// run instead, and step/floor-seal now record which tiles were stepped on so
// the explored board survives too. Every case runs the real handlers on the
// in-memory KV.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');

type Handler = (req: never, res: never) => Promise<unknown>;
type Reply = { status: number; body: Record<string, any> };

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let resetRateLimits: () => void;
const handlers: Record<string, Handler> = {};

const PLAYER = 'resumediver';
const TOKEN = 'resumedivertoken1';
const WIDTH = 15;
const HEIGHT = 11;
const runKey = hollowGateRunKey(PLAYER, TOKEN);
const saveKey = `save:${PLAYER}`;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    for (const [name, path] of [['resume', './resume.js'], ['step', './step.js'], ['floorSeal', './floor-seal.js']] as const) {
        handlers[name] = (await import(path)).default as unknown as Handler;
    }
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    resetRateLimits();
});

after(() => undefined);

async function invoke(name: string, body: Record<string, unknown>, asPlayer = PLAYER): Promise<Reply> {
    const reply: Reply = { status: 200, body: {} };
    const res = {
        setHeader: () => res,
        status: (status: number) => { reply.status = status; return res; },
        json: (data: Record<string, unknown>) => { reply.body = data; return res; },
        end: () => res,
    };
    await handlers[name]({
        method: 'POST', body: { playerName: PLAYER, ...body }, query: {},
        headers: { 'x-player-name': asPlayer, 'x-player-token': issuePlayerToken(asPlayer)! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return reply;
}

/** A legal floor (floor-seal's exact counts): spawn (1,1), content from tile 20, exit and stairs far away. */
function tiles(floor = 1) {
    const board = Array.from({ length: WIDTH * HEIGHT }, () => ({ kind: 'empty', terrain: 'room_floor' }));
    let index = 20;
    for (const [kind, count] of [
        ['battle', 4 + Math.min(5, floor)], ['elite', 1 + Math.floor(floor / 2)], ['trap', 1], ['chest', 3],
        ['shard_vein', 1 + Math.floor(floor / 2)], ['locked', 1], ['shrine', 1], ['story', 1], ['npc', 1],
    ] as const) {
        for (let placed = 0; placed < count; placed += 1) board[index++].kind = kind;
    }
    board[WIDTH * 9 + 1].kind = 'exit';
    board[WIDTH * 9 + 13].kind = 'descend';
    return board;
}
function manifest(floor = 1) {
    const validated = validateHollowGateFloorManifest({ floor, finalFloor: false, width: WIDTH, height: HEIGHT, playerX: 1, playerY: 1, tiles: tiles(floor) });
    if (!validated.ok) throw new Error(validated.reason);
    return validated.manifest;
}

async function seed(overrides: Partial<HollowGateRunToken> = {}) {
    const run: HollowGateRunToken = {
        playerName: PLAYER, mintedAt: Date.now(), floorDepth: 5, currentFloor: 2,
        seed: 'resume-seed', entryCurrencies: { ryo: 400 }, entryItems: {},
        offeredAugmentIds: ['keen-edge', 'warded-step', 'greedy-pact'], chosenAugmentId: 'greedy-pact', dailyRunOrdinal: 1,
        floorManifests: { '1': manifest(1), '2': manifest(2) },
        position: { x: 3, y: 1 }, keys: 2, torch: 7, threat: 36, wardSteps: 1, divinerUsed: true, secondWindArmed: true,
        stepVersion: 9, recentStepIds: [],
        resolvedEncounterIds: ['1:battle:floor:1:tile:20', '2:battle:floor:2:tile:21', '2:ambush:floor:2:ambush:threat-v4'],
        withdrawnEncounterIds: ['2:battle:floor:2:tile:22'],
        resolvedEventIds: ['event:1:chest:floor:1:tile:32', 'event:2:chest:floor:2:tile:33'],
        visitedTiles: { '1': '1'.padEnd(WIDTH * HEIGHT, '0'), '2': '01'.padEnd(WIDTH * HEIGHT, '0') },
        rewardLedger: { currencies: { ryo: 9000 }, items: {}, sourceIds: [] },
        ...overrides,
    };
    await kv.set(runKey, run);
    await kv.set(saveKey, { _saveVersion: 1, character: {
        name: PLAYER, level: 30, hp: 500, maxHp: 500, ryo: 400,
        lastHollowGateStart: { requestId: 'resume-start-0001', token: TOKEN, at: Date.now() },
        hollowGateRun: { floor: 2, runToken: TOKEN, serverSeed: run.seed, keys: 2, torch: 7, threat: 36, playerX: 3, playerY: 1 },
    } });
    return run;
}

test('hollowGateMarkVisited marks one tile per floor, idempotently, and ignores off-board positions', () => {
    const shape = { floor: 2, width: 4, height: 2 };
    const first = hollowGateMarkVisited(undefined, shape, { x: 1, y: 1 });
    assert.deepEqual(first, { '2': '00000100' });
    assert.equal(hollowGateMarkVisited(first, shape, { x: 1, y: 1 }), first, 'a tile already marked changes nothing');
    assert.deepEqual(hollowGateMarkVisited(first, { ...shape, floor: 3 }, { x: 0, y: 0 }), { '2': '00000100', '3': '10000000' });
    assert.equal(hollowGateMarkVisited(first, shape, { x: 4, y: 0 }), first);
    assert.equal(hollowGateMarkVisited(first, shape, null), first);
    assert.deepEqual(hollowGateMarkVisited({ '2': 'garbage' }, shape, { x: 0, y: 0 }), { '2': '10000000' }, 'a malformed mask restarts');
});

test('a step and a first floor seal record the tiles stepped on', async () => {
    await seed({ currentFloor: 1, floorManifests: {}, position: undefined, visitedTiles: undefined, divinerUsed: false });
    const sealed = await invoke('floorSeal', { token: TOKEN, floor: 1, width: WIDTH, height: HEIGHT, playerX: 1, playerY: 1, tiles: tiles() });
    assert.equal(sealed.status, 200, JSON.stringify(sealed.body));
    let run = (await kv.get<HollowGateRunToken>(runKey))!;
    assert.equal(run.visitedTiles?.['1']?.[1 * WIDTH + 1], '1', 'the spawn is stepped on');

    const moved = await invoke('step', { token: TOKEN, requestId: 'resume-step-0001', fromX: 1, fromY: 1, toX: 2, toY: 1 });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    run = (await kv.get<HollowGateRunToken>(runKey))!;
    const mask = run.visitedTiles!['1'];
    assert.equal(mask.length, WIDTH * HEIGHT);
    assert.equal(mask[1 * WIDTH + 2], '1');
    assert.equal([...mask].filter((bit) => bit === '1').length, 2);
});

test('resume returns the live run, limited to its current floor, and nothing reward-bearing', async () => {
    await seed();
    const reply = await invoke('resume', {});
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.equal(reply.body.live, true);
    const state = reply.body.run;
    assert.equal(state.token, TOKEN);
    assert.equal(state.seed, 'resume-seed');
    assert.equal(state.floor, 2);
    assert.equal(state.floorDepth, 5);
    assert.deepEqual(state.position, { x: 3, y: 1 });
    assert.deepEqual(state.manifest, manifest(2));
    assert.equal(state.chosenAugmentId, 'greedy-pact');
    assert.deepEqual(state.augmentOffers.map((offer: { id: string }) => offer.id), ['keen-edge', 'warded-step', 'greedy-pact']);
    assert.ok(state.augmentOffers.every((offer: Record<string, unknown>) => !('rewardMultiplier' in offer)), 'the multiplier stays sealed');
    assert.deepEqual([state.keys, state.torch, state.threat, state.wardSteps, state.divinerUsed, state.secondWindArmed], [2, 7, 36, 1, true, true]);
    assert.deepEqual(state.resolvedEncounterIds, ['2:battle:floor:2:tile:21', '2:ambush:floor:2:ambush:threat-v4']);
    assert.deepEqual(state.resolvedEventIds, ['event:2:chest:floor:2:tile:33']);
    assert.equal(state.visited, '01'.padEnd(WIDTH * HEIGHT, '0'));
    assert.deepEqual(state.entryCurrencies, { ryo: 400 });
    assert.equal(state.activeCombat, null);
    assert.equal(state.pendingAmbush, null);
    assert.equal(JSON.stringify(reply.body).includes('9000'), false, 'the reward ledger never leaves the server');
});

test('resume names an open pet duel with its mode, so the browser reopens the duel itself', async () => {
    const runId = 'hgcombat-resume-pet';
    await seed({ activeEncounter: { runId, nodeId: 'floor:2:tile:22', floor: 2, kind: 'battle', enemyProfileId: 'hollow-hound', createdAt: Date.now() } });
    await kv.set(hollowGateCombatBindingKey(runId), {
        runId, playerName: PLAYER, tokenDigest: createHash('sha256').update(TOKEN).digest('hex'),
        floor: 2, nodeId: 'floor:2:tile:22', kind: 'battle', status: 'active', combatMode: 'pet',
    });
    const reply = await invoke('resume', {});
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.deepEqual(reply.body.run.activeCombat, { runId, nodeId: 'floor:2:tile:22', floor: 2, kind: 'battle', mode: 'pet' });
});

test('resume reports no live run for a finished run, a missing run, or a save without one', async () => {
    assert.deepEqual((await invoke('resume', {})).body, { ok: true, live: false }, 'no save at all');

    await seed();
    const record = (await kv.get<Record<string, any>>(saveKey))!;
    await kv.set(saveKey, { ...record, character: { ...record.character, redeemedHollowGateRuns: [TOKEN] } });
    assert.deepEqual((await invoke('resume', {})).body, { ok: true, live: false }, 'a settled run is not resumable');

    await seed();
    await kv.del(runKey);
    assert.deepEqual((await invoke('resume', {})).body, { ok: true, live: false }, 'an expired run is not resumable');

    await seed();
    const pointerless = (await kv.get<Record<string, any>>(saveKey))!;
    await kv.set(saveKey, { ...pointerless, character: { ...pointerless.character, hollowGateRun: null, lastHollowGateStart: undefined } });
    assert.deepEqual((await invoke('resume', {})).body, { ok: true, live: false }, 'no pointer, no run');
});

test('the start marker alone still finds the live run', async () => {
    await seed();
    const record = (await kv.get<Record<string, any>>(saveKey))!;
    await kv.set(saveKey, { ...record, character: { ...record.character, hollowGateRun: null } });
    const reply = await invoke('resume', {});
    assert.equal(reply.body.live, true);
    assert.equal(reply.body.run.token, TOKEN);
});

test('only the run owner can resume it', async () => {
    await seed();
    const reply = await invoke('resume', {}, 'someoneelse');
    assert.equal(reply.status, 403, JSON.stringify(reply.body));
    assert.equal(reply.body.run, undefined);
});

test('a saved run keeps the open fight\'s mode through the save sanitizer', async () => {
    const { sanitizeChallengeProgress } = await import('../save/_sanitize-challenges.js');
    const active = { runId: 'hgcombat-x', nodeId: 'floor:2:tile:4', floor: 2, kind: 'battle', mode: 'pet' };
    const char: Record<string, unknown> = { hollowGateRun: { runToken: TOKEN, activeCombat: { ...active } } };
    sanitizeChallengeProgress(char, { hollowGateRun: { runToken: TOKEN } });
    assert.deepEqual((char.hollowGateRun as Record<string, unknown>).activeCombat, active);
    const junk: Record<string, unknown> = { hollowGateRun: { runToken: TOKEN, activeCombat: { ...active, mode: 'nuke' } } };
    sanitizeChallengeProgress(junk, { hollowGateRun: { runToken: TOKEN } });
    assert.equal(((junk.hollowGateRun as Record<string, unknown>).activeCombat as Record<string, unknown>).mode, undefined);
});
