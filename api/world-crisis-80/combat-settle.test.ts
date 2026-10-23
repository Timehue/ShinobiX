import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

/*
 * L80 world crisis deployment purse (2026-10 economy rebalance, owner
 * amendment A7): a won deployment pays 0.5 x A(L) per active minute of the
 * fight, once, from the sealed Tower session. A loss pays nothing.
 */
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'world-crisis-80-settle-test-secret-32-chars';

type Json = Record<string, unknown>;
const PLAYER = 'crisispurseplayer';
const MINUTE = 60_000;

let kv: typeof import('../_storage.js').kv;
let handler: (req: never, res: never) => Promise<unknown>;
let writeSession: typeof import('../towers/_tower-store.js').writeSession;
let token: string;
let village: import('../../shared/world-crisis-80.js').WorldCrisis80Village;
let sourceId: string;
let crisisId: string;

async function settle(runId: string) {
    const out = { status: 200, body: {} as Json };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; }, json(value: Json) { out.body = value; return res; }, end() { return res; } };
    await handler({
        method: 'POST',
        body: { playerName: PLAYER, runId },
        headers: { 'x-player-token': token, 'x-player-name': PLAYER },
        query: {},
        socket: { remoteAddress: '127.0.0.93' },
    } as never, res as never);
    return out;
}

async function deployment(runId: string, winner: 'squad' | 'enemy', minutes: number) {
    const now = Date.now();
    await writeSession({
        towerId: 'world-crisis-80', runId, floor: 1, seed: 1, partySize: 1,
        map: { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] },
        actors: [{
            id: 'sq-0', side: 'squad', name: PLAYER, ownerSlug: PLAYER, ai: false,
            hp: 500, maxHp: 1000, chakra: 0, maxChakra: 0, stamina: 0, maxStamina: 0,
            shield: 0, statuses: [], cooldowns: {}, pos: 0, character: {},
        }],
        turnQueue: [], activeIndex: 0, round: 6, activeAp: 0, actionsThisTurn: 0,
        groundEffects: [], objectiveState: { kind: 'defeat-all', completed: winner === 'squad', failed: winner !== 'squad' },
        phaseState: { pendingPhases: [], triggeredPhases: [] },
        status: 'done', winner, recentMoveTokens: [], rewardSettlementState: 'pending',
        log: [], createdAt: now - minutes * MINUTE, lastActionAt: now - minutes * MINUTE,
        worldCrisis80: { crisisId, village, sourceId },
    });
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ writeSession } = await import('../towers/_tower-store.js'));
    handler = (await import('./combat-settle.js')).default as unknown as typeof handler;
    token = (await import('../_auth.js')).issuePlayerToken(PLAYER)!;
    const crisis = await import('../../shared/world-crisis-80.js');
    crisisId = crisis.WORLD_CRISIS_80_ID;
    village = crisis.WORLD_CRISIS_80_VILLAGES[0]!;
    sourceId = crisis.worldCrisis80EncounterForVillage(village).sourceId;
    await kv.set(`save:${PLAYER}`, { character: { name: PLAYER, level: 80, ryo: 1_000, village } });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

const ryo = async () => Number(((await kv.get<Json>(`save:${PLAYER}`))!.character as Json).ryo);

test('a won deployment pays 0.5 x A(L) per active minute once', async () => {
    const runId = `wcr80-${'a'.repeat(32)}`;
    await deployment(runId, 'squad', 6);
    const first = await settle(runId);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    // A(80) = 300 ryo a minute; 6 minutes x 0.5 x 300 = 900. The store
    // stamps the terminal time on write, a millisecond or two after `now`.
    const purse = first.body.purse as { ryo: number; minutes: number };
    assert.equal(purse.ryo, 900);
    assert.equal(Math.round(purse.minutes), 6);
    assert.equal(await ryo(), 1_900);
    const again = await settle(runId);
    assert.equal(again.status, 200);
    assert.equal((again.body.purse as Json).reason, 'already-paid');
    assert.equal(await ryo(), 1_900, 'the replay pays nothing more');
});

test('a lost deployment pays no purse', async () => {
    const runId = `wcr80-${'b'.repeat(32)}`;
    await deployment(runId, 'enemy', 6);
    const lost = await settle(runId);
    assert.equal(lost.status, 200, JSON.stringify(lost.body));
    assert.equal(lost.body.purse, undefined);
    assert.equal(await ryo(), 1_900);
});
