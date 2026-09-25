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
const CAROL = 'rankedqueuecombatcarol';
const DAVE = 'rankedqueuecombatdave';

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let startRankedSeason: typeof import('../cron/_ranked-season.js').startRankedSeason;
let rankedQueue: Handler;
let session: Handler;
let move: Handler;
let claimRewards: Handler;
let leaderboards: Handler;
let buildBattleReceipt: typeof import('../_receipts.js').buildBattleReceipt;
let readBattleReceipt: typeof import('../_receipts.js').readBattleReceipt;
let receiptKey: typeof import('../_receipts.js').receiptKey;

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
    ({ buildBattleReceipt, readBattleReceipt, receiptKey } = await import('../_receipts.js'));
});

beforeEach(async () => {
    for (const key of await kv.keys('ranked:*')) await kv.del(key);
    for (const key of await kv.keys('pvp:ranked-queue*')) await kv.del(key);
    for (const key of await kv.keys('pvp:player-ranked-match-token-v2:*')) await kv.del(key);
    for (const key of await kv.keys('challenges:*')) await kv.del(key);
    for (const key of await kv.keys('challenge-outgoing:*')) await kv.del(key);
    for (const key of await kv.keys('pvp:pvp-*')) await kv.del(key);
    for (const key of await kv.keys('player:ranked-*')) await kv.del(key);
    for (const player of [ALICE, BOB, CAROL, DAVE]) {
        for (const key of await kv.keys(`player-ip:${player}:*`)) await kv.del(key);
        for (const key of await kv.keys(`player-fp:${player}:*`)) await kv.del(key);
    }
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
        kv.set(`save:${CAROL}`, { _saveVersion: 1, character: character(CAROL) }),
        kv.set(`save:${DAVE}`, { _saveVersion: 1, character: character(DAVE) }),
    ]);
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('responder recovers a lost queue mirror before and after session activation', async () => {
    assert.equal((await post(rankedQueue, ALICE, { name: ALICE, action: 'join' })).statusCode, 200);
    assert.equal((await post(rankedQueue, BOB, { name: BOB, action: 'join' })).statusCode, 200);

    const matched = await post(rankedQueue, ALICE, { name: ALICE, action: 'poll' });
    assert.equal(matched.statusCode, 200);
    const match = matched.body?.match;
    assert.ok(match?.matchId);

    await kv.del(`pvp:ranked-queue:match:${BOB}`);
    const queuedRecovery = await post(rankedQueue, BOB, { name: BOB, action: 'poll' });
    assert.equal(queuedRecovery.statusCode, 200, queuedRecovery.body?.error);
    assert.equal(queuedRecovery.body?.match?.matchId, match.matchId);

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

    await kv.del(`pvp:ranked-queue:match:${BOB}`);
    const activeRecovery = await post(rankedQueue, BOB, { name: BOB, action: 'poll' });
    assert.equal(activeRecovery.statusCode, 200, activeRecovery.body?.error);
    assert.equal(activeRecovery.body?.match?.matchId, match.matchId);
    assert.equal(activeRecovery.body?.match?.battleId, battleId);
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
    const smokeRole = usedConsumable.body?.activePlayer as 'p1' | 'p2';
    const smokePlayer = smokeRole === 'p1' ? ALICE : BOB;
    const usedSmoke = await post(move, smokePlayer, {
        battleId, role: smokeRole, action: 'item', itemId: 'item-smoke-bomb',
        moveToken: `ranked-smoke-${battleId}-${smokeRole}`,
    });
    assert.equal(usedSmoke.statusCode, 200, usedSmoke.body?.error);
    assert.equal(usedSmoke.body?.itemCharges?.[smokeRole]?.['item-smoke-bomb'], 1);
    for (const role of ['p1', 'p2'] as const) {
        assert.ok(usedSmoke.body?.[role]?.statuses?.some((status: { source?: string; kind?: string }) =>
            status.source === 'item-smoke-bomb' && status.kind === 'negative'),
            `${role} receives ranked Smoke Bomb's debuff`);
    }
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
    for (const role of ['p1', 'p2'] as const) {
        const fighter: Record<string, any> | undefined = created.body?.session?.[role];
        assert.equal(fighter?.character?.equipment?.thrown, RANKED_FORMAT_NEUTRAL_EQUIPMENT.thrown);
        assert.equal(fighter?.character?.equipment?.item3, 'item-smoke-bomb');
        assert.ok(fighter?.character?.pvpItems?.some((item: { id: string }) => item.id === 'item-smoke-bomb'));
        assert.equal(fighter?.character?.pvpItems?.find((item: { id: string }) => item.id === RANKED_FORMAT_NEUTRAL_EQUIPMENT.thrown)?.weaponEp, 31,
            'the queued ranked fighter receives the tuned server-catalog Kunai, not a stale client item');
        assert.equal(created.body?.session?.itemCharges?.[role]?.[RANKED_FORMAT_NEUTRAL_EQUIPMENT.thrown], 2);
        assert.equal(created.body?.session?.itemCharges?.[role]?.['item-smoke-bomb'], 2);
    }
    assert.equal((await kv.get<Record<string, any>>(`save:${ALICE}`))?.character?.maxHp, 200,
        'the equalized ranked resources are session-only and never overwrite a player save');

    // Complete this same admitted battle and exercise the claim response and
    // public board through their real handlers. Combat moves and the terminal
    // saga have separate tests; this closes their queue-to-report wiring.
    const lastSession = await kv.get<Record<string, any>>(`pvp:${battleId}`);
    assert.ok(lastSession);
    // The players have distinct public connections/devices but share two
    // infrastructure hops. These must not turn an official fight unrated.
    for (const player of [ALICE, BOB]) {
        await kv.set(`player-ip:${player}:10.0.0.3`, 1);
        await kv.set(`player-ip:${player}:162.158.14.68`, 1);
    }
    await kv.set(`player-ip:${ALICE}:86.123.45.67`, 1);
    await kv.set(`player-ip:${BOB}:8.8.8.8`, 1);
    await kv.set(`player-fp:${ALICE}:${'a'.repeat(32)}`, 1);
    await kv.set(`player-fp:${BOB}:${'b'.repeat(32)}`, 1);
    const terminal = { ...lastSession, status: 'done', winner: 'p1', endedAt: Date.now() };
    await kv.set(`pvp:${battleId}`, terminal);
    await kv.set(receiptKey(battleId), buildBattleReceipt(terminal as never, terminal.endedAt));
    const winnerClaim = await post(claimRewards, ALICE, {
        battleId, playerName: ALICE, outcome: 'win', completionVersion: 1,
    });
    assert.equal(winnerClaim.statusCode, 200, winnerClaim.body?.error);
    assert.equal(winnerClaim.body?.rating?.field, 'rankedRating');
    assert.equal(winnerClaim.body?.rating?.value, 1012);
    assert.equal(winnerClaim.body?.rating?.delta, 12);
    const loserClaim = await post(claimRewards, BOB, {
        battleId, playerName: BOB, outcome: 'loss', completionVersion: 1,
    });
    assert.equal(loserClaim.statusCode, 200, loserClaim.body?.error);
    assert.equal(loserClaim.body?.rating?.value, 988);
    assert.equal(loserClaim.body?.rating?.delta, -12, 'the loser sees the rating drop, not a positive gain');
    assert.equal((await readBattleReceipt(battleId))?.settlement?.ratingDelta, 12,
        'the shared battle receipt reports the same Elo movement regardless of who claims last');
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

test('level 15 and level 100 can enter one ranked fight with maxed jutsu and unchanged saves', async () => {
    const jutsuId = 'starter-nin-fire-2';
    for (const [player, level, mastery] of [[ALICE, 15, 1], [BOB, 100, 5]] as const) {
        const save = await kv.get<Record<string, any>>(`save:${player}`);
        assert.ok(save);
        await kv.set(`save:${player}`, {
            ...save,
            character: {
                ...save.character,
                level,
                specialty: 'Ninjutsu',
                equippedJutsuIds: [jutsuId],
                jutsuMastery: [{ jutsuId, level: mastery }],
            },
        });
    }
    assert.equal((await post(rankedQueue, ALICE, { name: ALICE, action: 'join' })).statusCode, 200);
    assert.equal((await post(rankedQueue, BOB, { name: BOB, action: 'join' })).statusCode, 200);
    const matched = await post(rankedQueue, ALICE, { name: ALICE, action: 'poll' });
    assert.equal(matched.statusCode, 200, matched.body?.error);
    assert.equal(matched.body?.match?.opponent, BOB);
    const match = matched.body?.match;
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
    const fighters = [created.body?.session?.p1, created.body?.session?.p2];
    assert.deepEqual(fighters.map(f => f?.character?.level), [15, 100]);
    for (const fighter of fighters) {
        assert.equal(fighter?.character?.rankedFormatCombat, true);
        assert.equal(fighter?.character?.jutsuMastery?.find((row: { jutsuId: string }) => row.jutsuId === jutsuId)?.level, 50);
        assert.equal(fighter?.character?.jutsu?.some((j: { id: string }) => j.id === jutsuId), true);
    }
    assert.equal(fighters[0]?.character?.jutsu?.[0]?.chakraCost, fighters[1]?.character?.jutsu?.[0]?.chakraCost,
        'ranked resource cost uses the same combat tier at both character levels');
    const { applyJutsu } = await import('./move.js');
    const lowLevelCast = applyJutsu(fighters[0], fighters[1], fighters[0].character.jutsu[0]);
    const highLevelCast = applyJutsu(fighters[1], fighters[0], fighters[1].character.jutsu[0]);
    assert.equal(lowLevelCast.opponent.hp, highLevelCast.opponent.hp,
        'equalized stats and mastery produce the same direct hit at level 15 and level 100');
    assert.equal((await kv.get<Record<string, any>>(`save:${ALICE}`))?.character?.jutsuMastery?.[0]?.level, 1);
    assert.equal((await kv.get<Record<string, any>>(`save:${BOB}`))?.character?.jutsuMastery?.[0]?.level, 5);
});

test('ranked queue blocks level 10 even when the client claims a higher level, then admits level 11', async () => {
    const saved = await kv.get<Record<string, any>>(`save:${ALICE}`);
    assert.ok(saved);
    await kv.set(`save:${ALICE}`, { ...saved, character: { ...saved.character, level: 10 } });
    const blocked = await post(rankedQueue, ALICE, { name: ALICE, action: 'join', level: 100 });
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.body?.errorCode, 'ranked-level-locked');
    assert.match(String(blocked.body?.error), /level 11/);
    const bypass = await post(session, ALICE, {
        p1Character: { name: ALICE }, p2Character: { name: BOB },
        ranked: true, rankedKind: 'player',
    });
    assert.equal(bypass.statusCode, 403, 'direct session creation also enforces the ranked floor');
    assert.equal(bypass.body?.errorCode, 'ranked-level-locked');
    await kv.set(`save:${ALICE}`, { ...saved, character: { ...saved.character, level: 11 } });
    const allowed = await post(rankedQueue, ALICE, { name: ALICE, action: 'join', level: 1 });
    assert.equal(allowed.statusCode, 200, allowed.body?.error);
    assert.equal(allowed.body?.inQueue, true);
});

/** CAROL vs DAVE ended, but its settlement is stuck: the gate still holds a terminal admission. */
async function stuckTerminalAdmission() {
    const { mintPlayerRankedMatchTokenWithStore } = await import('../_ranked-match-token.js');
    const { activatePlayerRankedAdmission, getPlayerRankedAdmission } = await import('../pet/_ranked-preparation.js');
    const { publishPlayerRankedTerminal } = await import('./_player-ranked-journal.js');
    const matchId = 'player-ranked-d2345678-1234-4123-8123-1234567890ab';
    const battleId = 'pvp-d2345678-1234-4123-8123-1234567890ab';
    const token = await mintPlayerRankedMatchTokenWithStore(kv, {
        a: CAROL, b: DAVE, aLevel: 24, bLevel: 24, aRating: 1000, bRating: 1000, matchId,
    });
    await activatePlayerRankedAdmission(kv, matchId, battleId);
    await publishPlayerRankedTerminal(kv, {
        battleId,
        p1: { name: CAROL },
        p2: { name: DAVE },
        status: 'done',
        winner: 'p1',
        ranked: false,
        rankedKind: 'player',
        playerRankedAuthorityVersion: 2,
        rankedMatchId: matchId,
        rankedSeasonId: token.seasonId,
        rankedSeasonEpoch: token.seasonEpoch,
        p1Rating: 1000,
        p2Rating: 1000,
        joined: { p1: true, p2: true },
        rewardAuthority: 'ranked',
        baseRewards: false,
        realFighters: { p1: true, p2: true },
        itemCharges: { p1: {}, p2: {} },
        itemsUsed: { p1: {}, p2: {} },
        log: [],
        createdAt: Date.now() - 60_000,
    } as never, { eligible: async () => true });
    // Its session row is gone, so queue traffic cannot finish it either.
    assert.equal((await getPlayerRankedAdmission(kv, matchId))?.phase, 'terminal');
    return matchId;
}

test('a poll whose nearest opponent is still settling a match pairs past them instead of failing', async () => {
    await stuckTerminalAdmission();
    const aliceSave = await kv.get<Record<string, any>>(`save:${ALICE}`);
    const bobSave = await kv.get<Record<string, any>>(`save:${BOB}`);
    await kv.set(`save:${BOB}`, { ...bobSave, character: { ...bobSave!.character, rankedRating: 1100 } });
    assert.equal(aliceSave?.character.rankedRating, 1000);

    const carolJoin = await post(rankedQueue, CAROL, { name: CAROL, action: 'join' });
    assert.equal(carolJoin.statusCode, 409, 'a player whose match still holds the gate is never re-queued');
    assert.equal(carolJoin.body?.errorCode, 'ranked-settlement-pending');
    assert.match(String(carolJoin.body?.error), /still being settled/);
    assert.equal(carolJoin.body?.inQueue, false);

    assert.equal((await post(rankedQueue, ALICE, { name: ALICE, action: 'join' })).statusCode, 200);
    assert.equal((await post(rankedQueue, BOB, { name: BOB, action: 'join' })).statusCode, 200);
    // An entry that predates this rule (or raced it): CAROL is Alice's
    // nearest rating, but her gate admission makes any pair with her unmintable.
    const queue = await kv.get<Array<Record<string, unknown>>>('pvp:ranked-queue') ?? [];
    const now = Date.now();
    await kv.set('pvp:ranked-queue', [...queue, {
        name: CAROL, level: 24, elo: 1000, joinedAt: now, lastPolledAt: now,
    }], { ex: 7200 });

    const alicePoll = await post(rankedQueue, ALICE, { name: ALICE, action: 'poll' });
    assert.equal(alicePoll.statusCode, 200, alicePoll.body?.error);
    assert.equal(alicePoll.body?.match?.opponent, BOB, 'the settling player is skipped, not minted');

    const carolPoll = await post(rankedQueue, CAROL, { name: CAROL, action: 'poll' });
    assert.equal(carolPoll.statusCode, 409);
    assert.equal(carolPoll.body?.errorCode, 'ranked-settlement-pending');
    const remaining = await kv.get<Array<{ name: string }>>('pvp:ranked-queue') ?? [];
    assert.equal(remaining.some((entry) => entry.name === CAROL), false, 'she leaves the pool with a reason');
});

test('a player who re-joins mid-match is never offered to others and gets the match back', async () => {
    assert.equal((await post(rankedQueue, ALICE, { name: ALICE, action: 'join' })).statusCode, 200);
    assert.equal((await post(rankedQueue, BOB, { name: BOB, action: 'join' })).statusCode, 200);
    const matched = await post(rankedQueue, ALICE, { name: ALICE, action: 'poll' });
    const match = matched.body?.match;
    assert.equal(match?.opponent, BOB);
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

    const rejoin = await post(rankedQueue, ALICE, { name: ALICE, action: 'join' });
    assert.equal(rejoin.statusCode, 200, rejoin.body?.error);
    assert.equal(rejoin.body?.inQueue, true);
    assert.equal(rejoin.body?.resumingMatch, true);
    const queue = await kv.get<Array<{ name: string }>>('pvp:ranked-queue') ?? [];
    assert.equal(queue.some((entry) => entry.name === ALICE), false, 'an admitted fighter is not in the pairing pool');

    assert.equal((await post(rankedQueue, DAVE, { name: DAVE, action: 'join' })).statusCode, 200);
    const davePoll = await post(rankedQueue, DAVE, { name: DAVE, action: 'poll' });
    assert.equal(davePoll.statusCode, 200, davePoll.body?.error);
    assert.equal(davePoll.body?.inQueue, true);
    assert.equal(davePoll.body?.match, null);

    const alicePoll = await post(rankedQueue, ALICE, { name: ALICE, action: 'poll' });
    assert.equal(alicePoll.statusCode, 200, alicePoll.body?.error);
    assert.equal(alicePoll.body?.match?.matchId, match.matchId);
    assert.equal(alicePoll.body?.match?.battleId, battleId, 'her poll restores the match she is already in');
});
