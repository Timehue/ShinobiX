import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import {
    RANKED_FORMAT_MAX_CHAKRA,
    RANKED_FORMAT_MAX_HP,
    RANKED_FORMAT_MAX_STAMINA,
    RANKED_FORMAT_NEUTRAL_EQUIPMENT,
} from './_ranked-format.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'ranked-queue-to-combat-test-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, any>; headers: Record<string, string> };

const ALICE = 'rankedqueuecombatalice';
const BOB = 'rankedqueuecombatbob';

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let startRankedSeason: typeof import('../cron/_ranked-season.js').startRankedSeason;
let rankedQueue: Handler;
let session: Handler;
let move: Handler;
let claimRewards: Handler;
let leaderboards: Handler;

function character(name: string) {
    return {
        name,
        level: 24,
        rankedRating: 1000,
        hp: 200,
        maxHp: 200,
        chakra: 100,
        maxChakra: 100,
        stamina: 100,
        maxStamina: 100,
        stats: { strength: 20, defense: 20, speed: 20, intelligence: 20, chakra: 20 },
        jutsu: [],
        equipment: { hand: 'thrown-shuriken' },
        inventory: ['thrown-shuriken'],
        itemStacks: [],
    };
}

function response() {
    const out: Out = { statusCode: 200, headers: {} };
    const res = {
        setHeader(name: string, value: string) { out.headers[name.toLowerCase()] = value; return res; },
        status(statusCode: number) { out.statusCode = statusCode; return res; },
        json(body: Record<string, any>) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

function request(player: string, body: Record<string, unknown>) {
    return {
        method: 'POST', body, query: {},
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(player) },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

async function post(handler: Handler, player: string, body: Record<string, unknown>) {
    const out = response();
    await handler(request(player, body), out.res);
    return out.out;
}

async function get(handler: Handler, player: string, query: Record<string, string>) {
    const out = response();
    await handler({
        method: 'GET', body: {}, query,
        headers: { 'x-player-token': issuePlayerToken(player) },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, out.res);
    return out.out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ startRankedSeason } = await import('../cron/_ranked-season.js'));
    rankedQueue = (await import('./ranked-queue.js')).default as unknown as Handler;
    session = (await import('./session.js')).default as unknown as Handler;
    move = (await import('./move.js')).default as unknown as Handler;
    claimRewards = (await import('./claim-rewards.js')).default as unknown as Handler;
    leaderboards = (await import('../player/leaderboards.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('ranked:*')) await kv.del(key);
    for (const key of await kv.keys('pvp:ranked-queue*')) await kv.del(key);
    for (const key of await kv.keys('pvp:player-ranked-match-token-v2:*')) await kv.del(key);
    for (const key of await kv.keys('challenges:*')) await kv.del(key);
    for (const key of await kv.keys('challenge-outgoing:*')) await kv.del(key);
    for (const key of await kv.keys('pvp:pvp-*')) await kv.del(key);
    await startRankedSeason(Date.now());
    await Promise.all([
        kv.set(`save:${ALICE}`, {
            _saveVersion: 1,
            character: { ...character(ALICE), rankedFormatWeaponId: 'elderbranch-katana' },
        }),
        kv.set(`save:${BOB}`, {
            _saveVersion: 1,
            character: { ...character(BOB), rankedFormatWeaponId: 'frostfang-oathblade' },
        }),
    ]);
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('two ranked queue entries create a ranked-format PvP combat session', async () => {
    assert.equal((await post(rankedQueue, ALICE, { name: ALICE, action: 'join' })).statusCode, 200);
    assert.equal((await post(rankedQueue, BOB, { name: BOB, action: 'join' })).statusCode, 200);

    const matched = await post(rankedQueue, ALICE, { name: ALICE, action: 'poll' });
    assert.equal(matched.statusCode, 200);
    const match = matched.body?.match;
    assert.equal(match?.opponent, BOB);
    assert.equal(match?.initiator, true);

    // The queue initiator publishes the session directly. Ranked queueing never
    // creates a challenge receipt and the opponent does not accept anything.
    const created = await post(session, ALICE, {
        p1Character: { name: ALICE },
        p2Character: { name: BOB },
        ranked: true,
        rankedKind: 'player',
        rankedMatchId: match.matchId,
        rankedSeasonId: match.seasonId,
        rankedSeasonEpoch: match.seasonEpoch,
    });
    assert.equal(created.statusCode, 200, created.body?.error);
    const battleId = String(created.body?.battleId ?? '');
    assert.ok(battleId);
    assert.equal(created.body?.session?.joined?.p1, true);
    assert.equal(created.body?.session?.joined?.p2, true,
        'a confirmed ranked queue pair starts combat without a second accept/join gate');
    assert.ok(Number.isFinite(created.body?.session?.turnStartedAt),
        'the opening ranked turn starts from the server-authoritative countdown');

    // A session published before direct seating can be repaired on its next
    // read; this is what releases a player stranded by the previous flow.
    const preSeating = await kv.get<Record<string, any>>(`pvp:${battleId}`);
    await kv.set(`pvp:${battleId}`, {
        ...preSeating,
        joined: { p1: true, p2: false },
        turnStartedAt: undefined,
    });
    const repaired = await get(session, ALICE, { id: battleId });
    assert.equal(repaired.statusCode, 200, repaired.body?.error);
    assert.equal(repaired.body?.joined?.p1, true);
    assert.equal(repaired.body?.joined?.p2, true,
        'an already-published player-ranked session is repaired instead of remaining stuck');
    assert.ok(Number.isFinite(repaired.body?.turnStartedAt));

    const opponentMatch = await post(rankedQueue, BOB, { name: BOB, action: 'poll' });
    assert.equal(opponentMatch.statusCode, 200);
    assert.equal(opponentMatch.body?.match?.battleId, battleId,
        'the responder discovers the authoritative session through the queue, not a challenge');

    // This remains idempotent for the responder's recovery-pointer handshake,
    // but combat must not depend on it completing.
    const joined = await post(move, BOB, {
        battleId,
        role: 'p2',
        action: 'join',
        moveToken: `join-${battleId}-p2`,
    });
    assert.equal(joined.statusCode, 200, joined.body?.error);
    const responderRecovery = await get(session, BOB, {
        pending: '1', playerName: BOB, recoveryProbeVersion: '2',
    });
    assert.equal(responderRecovery.statusCode, 200, responderRecovery.body?.error);
    assert.equal(responderRecovery.body?.battleId, battleId);
    assert.equal(responderRecovery.body?.role, 'p2',
        'the responder receives a durable recovery pointer after automatic seating');

    const activeRole = created.body?.session?.activePlayer as 'p1' | 'p2';
    const activePlayer = activeRole === 'p1' ? ALICE : BOB;
    const advanced = await post(move, activePlayer, {
        battleId,
        role: activeRole,
        action: 'wait',
        moveToken: `wait-${battleId}-${activeRole}`,
    });
    assert.equal(advanced.statusCode, 200, advanced.body?.error);
    assert.notEqual(advanced.body?.activePlayer, activeRole,
        'a seated ranked match advances the opening turn instead of remaining frozen');
    const itemRole = advanced.body?.activePlayer as 'p1' | 'p2';
    const itemPlayer = itemRole === 'p1' ? ALICE : BOB;
    const usedConsumable = await post(move, itemPlayer, {
        battleId,
        role: itemRole,
        action: 'item',
        itemId: RANKED_FORMAT_NEUTRAL_EQUIPMENT.item1,
        moveToken: `ranked-item-${battleId}-${itemRole}`,
    });
    assert.equal(usedConsumable.statusCode, 200, usedConsumable.body?.error);
    assert.equal(usedConsumable.body?.itemCharges?.[itemRole]?.[RANKED_FORMAT_NEUTRAL_EQUIPMENT.item1], 1);
    assert.equal(usedConsumable.body?.itemsUsed?.[itemRole]?.[RANKED_FORMAT_NEUTRAL_EQUIPMENT.item1], 1,
        'ranked permits the fixed neutral consumable kit and spends its sealed charge');
    assert.equal(created.body?.session?.rankedKind, 'player');
    assert.equal(created.body?.session?.rankedFormatVersion, 1);
    assert.equal(created.body?.session?.p1?.character?.equipment?.hand, 'elderbranch-katana');
    assert.equal(created.body?.session?.p2?.character?.equipment?.hand, 'frostfang-oathblade');
    assert.equal(created.body?.session?.p1?.character?.stats?.strength, 2500);
    assert.equal(created.body?.session?.p2?.character?.stats?.strength, 2500);
    assert.equal(created.body?.session?.p1?.hp, RANKED_FORMAT_MAX_HP);
    assert.equal(created.body?.session?.p2?.hp, RANKED_FORMAT_MAX_HP);
    assert.equal(created.body?.session?.p1?.chakra, RANKED_FORMAT_MAX_CHAKRA);
    assert.equal(created.body?.session?.p2?.stamina, RANKED_FORMAT_MAX_STAMINA);
    assert.equal((await kv.get<Record<string, any>>(`save:${ALICE}`))?.character?.maxHp, 200,
        'the equalized ranked resources are session-only and never overwrite a player save');

    // Complete this same admitted battle and exercise the claim response and
    // public board through their real handlers. Combat moves and the terminal
    // saga have separate tests; this closes their queue-to-report wiring.
    const lastSession = await kv.get<Record<string, any>>(`pvp:${battleId}`);
    assert.ok(lastSession);
    await kv.set(`pvp:${battleId}`, {
        ...lastSession, status: 'done', winner: 'p1', endedAt: Date.now(),
    });
    const winnerClaim = await post(claimRewards, ALICE, {
        battleId, playerName: ALICE, outcome: 'win', completionVersion: 1,
    });
    assert.equal(winnerClaim.statusCode, 200, winnerClaim.body?.error);
    assert.equal(winnerClaim.body?.rating?.field, 'rankedRating');
    assert.equal(winnerClaim.body?.rating?.value, 1012);
    const loserClaim = await post(claimRewards, BOB, {
        battleId, playerName: BOB, outcome: 'loss', completionVersion: 1,
    });
    assert.equal(loserClaim.statusCode, 200, loserClaim.body?.error);
    assert.equal(loserClaim.body?.rating?.value, 988);
    for (const [playerName, outcome] of [[ALICE, 'win'], [BOB, 'loss']] as const) {
        const ack = await post(claimRewards, playerName, {
            battleId, playerName, outcome, completionVersion: 1, completionAck: true,
        });
        assert.equal(ack.statusCode, 200, ack.body?.error);
        assert.equal(ack.body?.completionPending, false);
    }
    const board = await get(leaderboards, ALICE, { limit: '100' });
    assert.equal(board.statusCode, 200, board.body?.error);
    assert.equal(board.headers['cache-control'], 'no-store');
    const rankedRows = board.body?.boards?.find((entry: { id: string }) => entry.id === 'ranked')?.rows;
    assert.equal(rankedRows?.find((entry: { name: string }) => entry.name === ALICE)?.value, 1012);
    assert.equal(rankedRows?.find((entry: { name: string }) => entry.name === BOB)?.value, 988);
});
