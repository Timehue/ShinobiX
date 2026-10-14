import { randomBytes } from 'node:crypto';
import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { validateHollowGateFloorManifest } from './_floor-manifest.js';
import { hollowGateRunKey, type HollowGateRunToken } from './_run-token.js';
import { projectKvValue } from '../_storage-projection.js';

// A Hollow Gate step is the hottest write in the game: one request per tile,
// one tile every 175 ms while walking. It used to read the whole player save
// twice and compare-and-set it once on every tile, which made a step about
// 150 ms of database time in production and let the browser's step queue fall
// behind the walk. These cases pin the budget: a step touches the run row, and
// reads only the three save fields the pending-operation repair needs.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');

type Handler = (req: never, res: never) => Promise<unknown>;
type Reply = { status: number; body: Record<string, any> };
type Call = { method: string; key: string };

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let resetRateLimits: () => void;
let step: Handler;
let readHollowGatePendingProof: typeof import('./_pending-operation.js').readHollowGatePendingProof;
const calls: Call[] = [];

const PLAYER = 'stepbudgetdiver';
const TOKEN = 'stepbudgettoken01';
const WIDTH = 15, HEIGHT = 11;
const runKey = hollowGateRunKey(PLAYER, TOKEN);
const saveKey = `save:${PLAYER}`;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    ({ readHollowGatePendingProof } = await import('./_pending-operation.js'));
    step = (await import('./step.js')).default as unknown as Handler;
    // Production's Postgres store answers a projection where the data lives;
    // this stands in for it on the memory store, built on the unrecorded read.
    const store = kv as unknown as Record<string, unknown>;
    const rawMget = kv.mget.bind(kv);
    store.mgetProjected = async (keys: string[], projection: Record<string, readonly string[]>) =>
        (await rawMget(...keys)).map(value => projectKvValue(value, projection));
    for (const method of ['get', 'mget', 'mgetProjected', 'set', 'compareSet', 'compareSetMany', 'del', 'delIfEqual', 'incr']) {
        const original = store[method] as (...args: unknown[]) => Promise<unknown>;
        store[method] = async (...args: unknown[]) => {
            const first = args[0];
            const key = Array.isArray(first) ? first.map(op => (typeof op === 'string' ? op : (op as { key?: string }).key)).join(',') : String(first);
            calls.push({ method, key: method === 'mget' ? (args as string[]).join(',') : key });
            return original.apply(kv, args);
        };
    }
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    resetRateLimits();
});

async function invoke(body: Record<string, unknown>): Promise<Reply> {
    const reply: Reply = { status: 200, body: {} };
    const res = { setHeader: () => res, status: (s: number) => { reply.status = s; return res; }, json: (d: Record<string, unknown>) => { reply.body = d; return res; }, end: () => res };
    await step({ method: 'POST', body: { playerName: PLAYER, ...body }, query: {},
        headers: { 'x-player-name': PLAYER, 'x-player-token': issuePlayerToken(PLAYER)! }, socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
    return reply;
}

function board() {
    const tiles = Array.from({ length: WIDTH * HEIGHT }, () => ({ kind: 'empty', terrain: 'room_floor' }));
    let index = 20;
    for (const [kind, count] of [['battle', 5], ['elite', 1], ['trap', 1], ['chest', 3], ['shard_vein', 1], ['locked', 1], ['shrine', 1], ['story', 1], ['npc', 1]] as const) {
        for (let placed = 0; placed < count; placed += 1) tiles[index++].kind = kind;
    }
    tiles[WIDTH * 9 + 1].kind = 'exit';
    tiles[WIDTH * 9 + 13].kind = 'descend';
    const validated = validateHollowGateFloorManifest({ floor: 1, finalFloor: false, width: WIDTH, height: HEIGHT, playerX: 1, playerY: 1, tiles });
    if (!validated.ok) throw new Error(validated.reason);
    return validated.manifest;
}

async function seed() {
    const run: HollowGateRunToken = {
        playerName: PLAYER, mintedAt: Date.now(), floorDepth: 5, currentFloor: 1, seed: 'budget-seed',
        entryCurrencies: { ryo: 400 }, entryItems: {}, offeredAugmentIds: ['keen-edge', 'warded-step', 'greedy-pact'],
        chosenAugmentId: 'greedy-pact', dailyRunOrdinal: 1, floorManifests: { '1': board() },
        position: { x: 1, y: 4 }, keys: 1, torch: 10, threat: 0, wardSteps: 0, stepVersion: 0, recentStepIds: [],
        resolvedEncounterIds: [], resolvedEventIds: [], rewardLedger: { currencies: {}, items: {}, sourceIds: [] },
    } as HollowGateRunToken;
    await kv.set(runKey, run);
    await kv.set(saveKey, { _saveVersion: 7, character: {
        name: PLAYER, level: 40, hp: 900, maxHp: 900, ryo: 400,
        lastHollowGateStart: { requestId: 'budget-start-0001', token: TOKEN, at: Date.now() },
        hollowGateRun: { floor: 1, runToken: TOKEN, serverSeed: run.seed, keys: 1, torch: 10, threat: 0, playerX: 1, playerY: 4 },
    } });
}

test('a step reads three save fields and never reads or rewrites the player save', async () => {
    await seed();
    const saveBefore = await kv.get(saveKey);
    calls.length = 0;
    const moved = await invoke({ token: TOKEN, requestId: 'budget-step-0001', fromX: 1, fromY: 4, toX: 2, toY: 4 });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.deepEqual(moved.body.position, { x: 2, y: 4 });

    const saveCalls = calls.filter(call => call.key.split(',').includes(saveKey));
    assert.deepEqual(saveCalls.map(call => call.method), ['mgetProjected'], 'the only save access is the pending-operation projection');
    assert.equal(calls.some(call => call.key === `lock:${saveKey}`), false, 'a step never takes the save lock');
    assert.deepEqual(calls.filter(call => call.key === runKey).map(call => call.method), ['get', 'set'], 'the run row is read once and written once');
    assert.ok(calls.length <= 8, `a step makes at most 8 storage calls, made ${calls.length}: ${calls.map(c => c.method).join(' ')}`);

    assert.deepEqual(await kv.get(saveKey), saveBefore, 'the save, its version and its projection are untouched');
    assert.equal('_saveVersion' in moved.body, false, 'no save version: nothing was written to the save');
    const run = (await kv.get<HollowGateRunToken>(runKey))!;
    assert.deepEqual(run.position, { x: 2, y: 4 }, 'the run row stays the authority for position');
    assert.equal(run.stepVersion, 1);
});

test('a replayed step answers from the run row without touching the save', async () => {
    await seed();
    const first = await invoke({ token: TOKEN, requestId: 'budget-step-0002', fromX: 1, fromY: 4, toX: 2, toY: 4 });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const saveBefore = await kv.get(saveKey);
    calls.length = 0;
    const replay = await invoke({ token: TOKEN, requestId: 'budget-step-0002', fromX: 1, fromY: 4, toX: 2, toY: 4 });
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.alreadyReported, true);
    assert.deepEqual(replay.body.position, { x: 2, y: 4 });
    assert.equal(replay.body.threat, first.body.threat);
    assert.deepEqual(calls.filter(call => call.key.split(',').includes(saveKey)).map(call => call.method), ['mgetProjected']);
    assert.deepEqual(await kv.get(saveKey), saveBefore);
});

test('the proof projection reads exactly what the whole character would have', async () => {
    const proof = { version: 1, token: TOKEN, kind: 'event', id: 'chest:floor:1:tile:27', changes: [], terminal: false, response: { ok: true } };
    const shapes: Array<[string, unknown]> = [
        ['no save', undefined],
        ['no character', { _saveVersion: 1 }],
        ['null character', { _saveVersion: 1, character: null }],
        ['no run', { character: { name: PLAYER } }],
        ['null run', { character: { name: PLAYER, hollowGateRun: null } }],
        ['run without a token', { character: { name: PLAYER, hollowGateRun: { floor: 2 } } }],
        ['null token', { character: { name: PLAYER, hollowGateRun: { runToken: null } } }],
        ['live run with a proof', { character: { name: PLAYER, hollowGateRun: { runToken: TOKEN, floor: 1, torch: 3 }, hollowGatePendingOperation: proof, redeemedHollowGateRuns: ['old-run'] } }],
        ['explicit null proof', { character: { name: PLAYER, hollowGateRun: { runToken: TOKEN }, hollowGatePendingOperation: null } }],
    ];
    for (const [label, record] of shapes) {
        await kv.del(saveKey);
        if (record !== undefined) await kv.set(saveKey, record);
        const character = (record as { character?: Record<string, unknown> } | undefined)?.character;
        const view = await readHollowGatePendingProof(kv, PLAYER);
        const expected = character && typeof character === 'object'
            ? Object.fromEntries(Object.entries({
                hollowGatePendingOperation: character.hollowGatePendingOperation,
                hollowGateRun: character.hollowGateRun && typeof character.hollowGateRun === 'object' && 'runToken' in (character.hollowGateRun as object)
                    ? { runToken: (character.hollowGateRun as { runToken: unknown }).runToken } : undefined,
                redeemedHollowGateRuns: character.redeemedHollowGateRuns,
            }).filter(([, value]) => value !== undefined))
            : record === undefined ? undefined : {};
        assert.deepEqual(view, expected, label);
    }
});
