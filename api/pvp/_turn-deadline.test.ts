import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PvpFighter, PvpSession } from './session.js';
import {
    PVP_PREFIGHT_COUNTDOWN_MS,
    PVP_TURN_CLIENT_LEAD_MS,
    PVP_TURN_GRACE_MS,
    PVP_TURN_MS,
    PVP_TURN_SECONDS,
    pvpTurnClientExpiryAt,
    pvpTurnDeadlineAt,
} from '../../shared/pvp-turn.js';

process.env.SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_KEY ??= 'x';
process.env.SESSION_SECRET = 'pvp-turn-deadline-test-secret';
process.env.DISABLE_COMBAT_RECEIPTS = '1';

const store = new Map<string, unknown>();
const clone = <T>(v: T): T => (v === undefined || v === null) ? null as T : JSON.parse(JSON.stringify(v));

type Handler = (req: never, res: never) => Promise<unknown>;
let moveHandler: Handler;
let sessionHandler: Handler;
let issuePlayerToken: (name: string, ttlMs?: number) => string | null;
let enforcePvpTurnDeadline: typeof import('./_turn-deadline.js')['enforcePvpTurnDeadline'];
let pvpTurnLapsed: typeof import('./_turn-deadline.js')['pvpTurnLapsed'];

before(async () => {
    const storage = await import('../_storage.js');
    const kv = storage.kv;
    kv.get = async <T,>(key: string) => clone(store.get(key)) as T | null;
    kv.set = async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        if (options?.nx && store.has(key)) return null;
        store.set(key, clone(value));
        return 'OK' as const;
    };
    kv.compareSet = async (key: string, expected: unknown, value: unknown) => {
        const current = store.has(key) ? clone(store.get(key)) : null;
        if (JSON.stringify(current) !== JSON.stringify(clone(expected))) return false;
        store.set(key, clone(value));
        return true;
    };
    kv.del = async (...keys: string[]) => keys.reduce((n, key) => n + (store.delete(key) ? 1 : 0), 0);
    kv.delIfEqual = async (key: string, expected: string) => {
        if (store.get(key) !== expected) return false;
        store.delete(key);
        return true;
    };
    kv.incr = async (key: string) => {
        const next = (Number(store.get(key)) || 0) + 1;
        store.set(key, next);
        return next;
    };
    kv.keys = async (pattern: string) => {
        const prefix = pattern.replace(/\*.*$/, '');
        return [...store.keys()].filter((key) => key.startsWith(prefix));
    };
    kv.mget = async (...keys: string[]) => keys.map((key) => clone(store.get(key))) as never;
    kv.hgetall = async <T,>(key: string) => clone(store.get(key)) as T | null;
    (kv as unknown as Record<string, unknown>).hkeys = async (key: string) => Object.keys((store.get(key) as object) ?? {});
    (kv as unknown as Record<string, unknown>).hset = async (key: string, fields: Record<string, unknown>) => {
        store.set(key, { ...((store.get(key) as object) ?? {}), ...clone(fields) as object });
        return Object.keys(fields).length;
    };
    (kv as unknown as Record<string, unknown>).hdel = async (key: string, ...fields: string[]) => {
        const current = { ...((store.get(key) as Record<string, unknown>) ?? {}) };
        let removed = 0;
        for (const field of fields) {
            if (field in current) { delete current[field]; removed++; }
        }
        store.set(key, current);
        return removed;
    };

    moveHandler = (await import('./move.js')).default as unknown as Handler;
    sessionHandler = (await import('./session.js')).default as unknown as Handler;
    issuePlayerToken = (await import('../_auth.js')).issuePlayerToken;
    ({ enforcePvpTurnDeadline, pvpTurnLapsed } = await import('./_turn-deadline.js'));
});

beforeEach(() => { store.clear(); });

function fakeRes() {
    const out = { statusCode: 200, body: undefined as unknown, headers: {} as Record<string, unknown> };
    const res = {
        setHeader: (key: string, value: unknown) => { out.headers[key] = value; return res; },
        status: (code: number) => { out.statusCode = code; return res; },
        json: (body: unknown) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function postMove(playerName: string, body: Record<string, unknown>) {
    const token = issuePlayerToken(playerName);
    assert.ok(token, 'test session token should be minted');
    const { res, out } = fakeRes();
    await moveHandler({
        method: 'POST',
        body: { playerName, ...body },
        headers: { 'x-player-name': playerName, 'x-player-token': token, 'x-forwarded-for': '10.0.0.1' },
        socket: { remoteAddress: '10.0.0.1' },
    } as never, res);
    return out;
}

async function pollSession(battleId: string, ip = '10.0.0.9') {
    const { res, out } = fakeRes();
    await sessionHandler({
        method: 'GET',
        query: { id: battleId },
        headers: { 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res);
    return out;
}

const stats = Object.fromEntries([
    'strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense',
].map((k) => [k, 500]));

function fighter(name: string, pos: number): PvpFighter {
    return {
        name, hp: 5000, maxHp: 5000, chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000,
        shield: 0, statuses: [],
        character: { name, level: 100, specialty: 'Ninjutsu', stats, jutsu: [], jutsuMastery: [] },
        pos,
    };
}

function session(battleId: string, patch: Partial<PvpSession> = {}): PvpSession {
    const now = Date.now();
    return {
        battleId,
        p1: fighter('alice', 0),
        p2: fighter('bob', 1),
        round: 1,
        activePlayer: 'p1',
        ap: { p1: 100, p2: 100 },
        actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} },
        log: ['Battle begins.'],
        status: 'active',
        winner: null,
        rewardAuthority: 'challenge',
        joined: { p1: true, p2: true },
        createdAt: now - 10_000,
        lastMoveAt: now - 10_000,
        turnStartedAt: now,
        ...patch,
    };
}

const stored = (id: string) => store.get(`pvp:${id}`) as PvpSession;
const seed = (s: PvpSession) => store.set(`pvp:${s.battleId}`, clone(s));
const LAPSED = PVP_TURN_MS + PVP_TURN_GRACE_MS + 500;

test('the shared turn clock is the single 45s constant both halves read', () => {
    assert.equal(PVP_TURN_SECONDS, 45);
    assert.equal(PVP_TURN_MS, 45_000);
});

test('the browser countdown always expires strictly before the server deadline', () => {
    const anchor = 1_700_000_000_000;
    // The ring shows the honest 45s the player is promised...
    assert.equal(pvpTurnClientExpiryAt(anchor), anchor + PVP_TURN_MS);
    // ...and that is a whole grace window ahead of the server's own check, so a
    // present player's polite `auto: true` wait is structurally always first.
    assert.ok(pvpTurnClientExpiryAt(anchor) <= pvpTurnDeadlineAt(anchor) - PVP_TURN_CLIENT_LEAD_MS);
    assert.ok(PVP_TURN_GRACE_MS >= PVP_TURN_CLIENT_LEAD_MS,
        'the grace must cover the client lead or the server would fire first');
    // Defence in depth for the 5s poll fallback plus mobile latency.
    assert.ok(PVP_TURN_GRACE_MS >= 8_000);
});

test('a fresh turn is not lapsed; one older than turn + grace is', () => {
    const fresh = session('fresh');
    assert.equal(pvpTurnLapsed(fresh), false);
    assert.equal(pvpTurnLapsed(fresh, Date.now() + PVP_TURN_MS + 1_000), false, 'inside the grace window');
    assert.equal(pvpTurnLapsed(fresh, Date.now() + LAPSED), true);
    assert.equal(pvpTurnLapsed({ ...fresh, joined: { p1: true, p2: false } }, Date.now() + LAPSED), false,
        'the clock does not run until both fighters are seated');
    assert.equal(pvpTurnLapsed({ ...fresh, status: 'done' }, Date.now() + LAPSED), false);
    // Opt-out kill switch (test harnesses only): the clock simply never runs.
    process.env.DISABLE_PVP_TURN_DEADLINE = '1';
    try { assert.equal(pvpTurnLapsed(fresh, Date.now() + LAPSED), false, 'DISABLE_PVP_TURN_DEADLINE=1 stops the clock'); }
    finally { delete process.env.DISABLE_PVP_TURN_DEADLINE; }
});

test('turn lapses -> the server auto-waits the idle player on the next poll by anyone', async () => {
    seed(session('lapse-poll', { turnStartedAt: Date.now() - LAPSED }));

    const poll = await pollSession('lapse-poll');
    assert.equal(poll.statusCode, 200);
    const body = poll.body as PvpSession;
    assert.equal(body.activePlayer, 'p2', 'alice\'s lapsed turn passed to bob');
    assert.equal(body.consecAutoWait?.p1, 1, 'the idle skip is counted exactly as the client auto flag did');
    assert.equal(body.actionsThisTurn, 0);
    assert.equal(body.ap.p2, 100);
    assert.ok(body.log.some((line) => /ran out of time/.test(line)));
    assert.ok(Number(body.turnStartedAt) >= Date.now() - 2_000, 'the new turn\'s clock starts at commit');
    assert.equal(stored('lapse-poll').activePlayer, 'p2', 'persisted, not response-only');
    assert.equal(store.has('pvp:lapse-poll:lock'), false, 'the move lock is released');

    // Idempotent: polling again immediately does not pass bob's fresh turn.
    const again = await pollSession('lapse-poll');
    assert.equal((again.body as PvpSession).activePlayer, 'p2');
    assert.equal((again.body as PvpSession).consecAutoWait?.p2 ?? 0, 0);
});

test('a lapsed player who DID act this turn has the streak reset, not bumped', async () => {
    seed(session('lapse-acted', { turnStartedAt: Date.now() - LAPSED, actionsThisTurn: 2, consecAutoWait: { p1: 1 } }));
    const poll = await pollSession('lapse-acted');
    assert.equal((poll.body as PvpSession).activePlayer, 'p2');
    assert.equal((poll.body as PvpSession).consecAutoWait?.p1, 0);
});

test('the opponent\'s own move on a lapsed turn advances the clock first, then applies', async () => {
    seed(session('lapse-move', { turnStartedAt: Date.now() - LAPSED }));
    const out = await postMove('bob', { battleId: 'lapse-move', role: 'p2', action: 'wait', moveToken: 'bob-wait-1' });
    assert.equal(out.statusCode, 200);
    const body = out.body as PvpSession;
    assert.equal(body.rejected, undefined, 'bob\'s action was not rejected as out-of-turn');
    assert.equal(body.consecAutoWait?.p1, 1, 'alice was auto-waited by the server');
    assert.equal(body.activePlayer, 'p1', 'bob\'s manual wait then handed the turn back');
    assert.equal(body.round, 2);
});

test('the lapsed player\'s late action (even a legacy auto:true wait) cannot bypass the deadline', async () => {
    seed(session('lapse-late', { turnStartedAt: Date.now() - LAPSED }));
    const out = await postMove('alice', { battleId: 'lapse-late', role: 'p1', action: 'wait', auto: true, moveToken: 'alice-late' });
    assert.equal(out.statusCode, 200);
    const body = out.body as PvpSession;
    assert.match(String(body.rejected?.reason), /no longer your turn/i);
    assert.equal(body.activePlayer, 'p2');
    assert.equal(body.consecAutoWait?.p1, 1, 'counted once by the server, not twice');
});

test('repeated lapses -> the AFK claim becomes available naturally', async () => {
    seed(session('lapse-afk', { turnStartedAt: Date.now() - LAPSED }));
    // Turn 1: alice lapses (streak 1) -> bob's turn.
    await pollSession('lapse-afk');
    assert.equal(stored('lapse-afk').consecAutoWait?.p1, 1);
    // Bob plays normally.
    const bobWait = await postMove('bob', { battleId: 'lapse-afk', role: 'p2', action: 'wait', moveToken: 'bob-w1' });
    assert.equal((bobWait.body as PvpSession).activePlayer, 'p1');
    // Turn 2: alice lapses again (streak 2) -> bob's turn; the forfeit warning is logged.
    seed({ ...stored('lapse-afk'), turnStartedAt: Date.now() - LAPSED });
    const warned = await pollSession('lapse-afk');
    assert.equal((warned.body as PvpSession).consecAutoWait?.p1, 2);
    assert.ok((warned.body as PvpSession).log.some((line) => /skipped 2 rounds in a row/.test(line)));
    // Bob plays again, alice's third turn begins; bob claims during it.
    await postMove('bob', { battleId: 'lapse-afk', role: 'p2', action: 'wait', moveToken: 'bob-w2' });
    assert.equal(stored('lapse-afk').activePlayer, 'p1');
    const claim = await postMove('bob', { battleId: 'lapse-afk', role: 'p2', action: 'claim-afk-win', moveToken: 'bob-claim' });
    assert.equal(claim.statusCode, 200);
    const done = claim.body as PvpSession;
    assert.equal(done.rejected, undefined);
    assert.equal(done.status, 'done');
    assert.equal(done.winner, 'p2');
    assert.ok(done.log.some((line) => /forfeits — skipped 2 rounds/.test(line)));
});

test('an acting player is never lapsed across a multi-action turn', async () => {
    // Alice's turn started nearly a full turn ago and she now acts. Under the
    // old "clock starts at endTurn" rule her second action would have been
    // stolen by the server at ~48s with time still on her ring.
    const openedAt = Date.now() - (PVP_TURN_MS - 2_000);
    seed(session('multi-action', { turnStartedAt: openedAt }));

    const first = await postMove('alice', { battleId: 'multi-action', role: 'p1', action: 'basicAttack', moveToken: 'multi-1' });
    assert.equal(first.statusCode, 200);
    const afterFirst = first.body as PvpSession;
    assert.equal(afterFirst.rejected, undefined, 'her action was not bounced by the deadline');
    assert.equal(afterFirst.activePlayer, 'p1', 'she still holds the turn — she has AP left');
    assert.equal(afterFirst.actionsThisTurn, 1);
    assert.ok(Number(afterFirst.turnStartedAt) >= Date.now() - 2_000, 'a real action re-stamps the clock');
    assert.equal(afterFirst.consecAutoWait?.p1 ?? 0, 0, 'acting can never accrue the AFK streak');

    // The ORIGINAL turn start is now past its old deadline; the live row is not,
    // because the deadline follows her last action rather than the turn start.
    assert.equal(pvpTurnLapsed({ ...stored('multi-action'), turnStartedAt: openedAt }, Date.now() + PVP_TURN_MS - 3_000), true,
        'sanity: the pre-fix anchor WOULD have lapsed by now');
    assert.equal(pvpTurnLapsed(stored('multi-action'), Date.now() + PVP_TURN_MS - 3_000), false,
        'the live row is not lapsed — she acted');

    // A second action inside the same turn behaves identically.
    seed({ ...stored('multi-action'), turnStartedAt: Date.now() - (PVP_TURN_MS - 2_000) });
    const second = await postMove('alice', { battleId: 'multi-action', role: 'p1', action: 'basicAttack', moveToken: 'multi-2' });
    const afterSecond = second.body as PvpSession;
    assert.equal(afterSecond.rejected, undefined);
    assert.equal(afterSecond.activePlayer, 'p1');
    assert.equal(afterSecond.actionsThisTurn, 2);
    assert.ok(Number(afterSecond.turnStartedAt) >= Date.now() - 2_000, 'and re-stamps again');
});

test('a wait never keeps the waiting player own clock alive - only real actions re-stamp', async () => {
    seed(session('wait-clock', { turnStartedAt: Date.now() - 40_000 }));
    const out = await postMove('alice', { battleId: 'wait-clock', role: 'p1', action: 'wait', auto: true, moveToken: 'wait-clock-1' });
    const body = out.body as PvpSession;
    assert.equal(body.rejected, undefined);
    assert.equal(body.activePlayer, 'p2', 'the wait ended her turn instead of extending it');
    assert.equal(body.consecAutoWait?.p1, 1, 'an idle auto-wait still counts as a skipped round');
    assert.equal(body.actionsThisTurn, 0);

    // The fresh stamp belongs to BOB's new turn — alice cannot wait her way to
    // an unlapsable clock, so her next idle turn lapses on schedule.
    seed({ ...stored('wait-clock'), activePlayer: 'p1', actionsThisTurn: 0, turnStartedAt: Date.now() - LAPSED });
    const poll = await pollSession('wait-clock');
    assert.equal((poll.body as PvpSession).consecAutoWait?.p1, 2, 'a second idle turn lapses server-side');
});

test('claim-afk-win is never blocked by the deadline flipping the turn to the claimant', async () => {
    // Alice has banked 2 skipped rounds and the server's own enforcement (which
    // runs on every read) has just handed the turn BACK to bob, the claimant.
    seed(session('claim-race', {
        activePlayer: 'p2',
        consecAutoWait: { p1: 2 },
        turnStartedAt: Date.now() - LAPSED,
        lastMoveAt: Date.now() - 10_000,
    }));
    const claim = await postMove('bob', { battleId: 'claim-race', role: 'p2', action: 'claim-afk-win', moveToken: 'claim-race-1' });
    assert.equal(claim.statusCode, 200);
    const body = claim.body as PvpSession;
    assert.equal(body.rejected, undefined, 'the claim was not bounced for landing on the claimant own turn');
    assert.equal(body.status, 'done');
    assert.equal(body.winner, 'p2');
    // The exempt claim also never ran enforcement itself, so it cannot have
    // advanced the very turn it is judging.
    assert.equal(body.consecAutoWait?.p1, 2);
    assert.ok(body.log.some((line) => /forfeits/.test(line)));
});

test('claiming on your own turn is still refused while the opponent is short of 2 skips', async () => {
    seed(session('own-turn-claim', { activePlayer: 'p2', consecAutoWait: { p1: 1 }, lastMoveAt: Date.now() - 5_000 }));
    const claim = await postMove('bob', { battleId: 'own-turn-claim', role: 'p2', action: 'claim-afk-win', moveToken: 'own-turn-1' });
    assert.match(String((claim.body as PvpSession).rejected?.reason), /opponent.s turn/i);
    assert.equal(stored('own-turn-claim').status, 'active');
});

test('an early AFK claim is still rejected exactly as before', async () => {
    seed(session('early-claim'));
    const claim = await postMove('bob', { battleId: 'early-claim', role: 'p2', action: 'claim-afk-win', moveToken: 'early' });
    assert.match(String((claim.body as PvpSession).rejected?.reason), /skipped 0\/2 rounds/);
    assert.equal(stored('early-claim').status, 'active');
});

test('a pre-deploy row without turnStartedAt is stamped, never lapsed, on first contact', async () => {
    const legacy = session('legacy-row', { createdAt: Date.now() - 600_000, lastMoveAt: Date.now() - 600_000 });
    delete legacy.turnStartedAt;
    seed(legacy);
    const poll = await pollSession('legacy-row');
    const body = poll.body as PvpSession;
    assert.equal(body.activePlayer, 'p1', 'still alice\'s turn');
    assert.equal(body.consecAutoWait?.p1 ?? 0, 0);
    assert.ok(Number(body.turnStartedAt) > Date.now(), 'clock stamped forward by the pre-fight countdown');
    assert.ok(Number(body.turnStartedAt) <= Date.now() + PVP_PREFIGHT_COUNTDOWN_MS + 50);
});

test('the deadline does not run before both fighters have joined; join starts the clock', async () => {
    const unjoined = session('join-clock', { joined: { p1: true, p2: false } });
    delete unjoined.turnStartedAt;
    seed(unjoined);
    await pollSession('join-clock');
    assert.equal(stored('join-clock').turnStartedAt, undefined, 'no clock while waiting for the second fighter');

    const joined = await postMove('bob', { battleId: 'join-clock', role: 'p2', action: 'join', moveToken: 'join-join-clock-p2' });
    assert.equal(joined.statusCode, 200);
    const startedAt = Number(stored('join-clock').turnStartedAt);
    assert.ok(startedAt > Date.now() && startedAt <= Date.now() + PVP_PREFIGHT_COUNTDOWN_MS + 50,
        'seating the second fighter starts the first turn after the pre-fight countdown');
});

test('an auto-wait that ENDS the match replays the terminal effects, exactly once', async () => {
    // The only reward-affecting branch in the module: `applyPvpServerAutoWait`
    // can terminalize (here, the round limit), and the server owes that row the
    // same durable terminal replay move.ts runs after its own CAS. Skipping it
    // would leave a finished fight with no sealed recovery snapshot — the anchor
    // a reload uses to find and repair an unpaid completion.
    const { MAX_ROUNDS } = await import('../combat-core/constants.js');
    const kv = (await import('../_storage.js')).kv;
    // p2 is active on the last round, so ending their turn rolls past MAX_ROUNDS.
    // Equal HP → a draw, which is terminal without paying any winner.
    seed(session('lapse-final', {
        activePlayer: 'p2',
        round: MAX_ROUNDS,
        turnStartedAt: Date.now() - LAPSED,
    }));

    const result = await enforcePvpTurnDeadline(kv, 'lapse-final', stored('lapse-final'));
    assert.equal(result.applied, 'auto-wait');
    assert.equal(result.session.status, 'done', 'the round limit ended the fight on the auto-wait');
    assert.equal(result.session.winner, 'draw');
    assert.equal(stored('lapse-final').status, 'done', 'persisted, not response-only');

    // The terminal replay's first, mandatory phase: the immutable snapshot that
    // claims pay out from. Its presence is the proof the branch ran.
    const snapshot = store.get('pvp:reward-recovery:lapse-final') as { battleId?: string; session?: PvpSession } | undefined;
    assert.equal(snapshot?.battleId, 'lapse-final', 'the terminal recovery snapshot was sealed');
    assert.equal(snapshot?.session?.status, 'done');
    assert.equal(snapshot?.session?.winner, 'draw');

    // Idempotent: a second reader over the now-terminal row applies nothing and
    // cannot re-seal a conflicting snapshot.
    const again = await enforcePvpTurnDeadline(kv, 'lapse-final', stored('lapse-final'));
    assert.equal(again.applied, 'none');
    assert.deepEqual(store.get('pvp:reward-recovery:lapse-final'), snapshot);
    assert.equal(store.has('pvp:lapse-final:lock'), false, 'the move lock is released');
});

test('a contended lock leaves the snapshot untouched (another writer is applying it)', async () => {
    const s = session('contended', { turnStartedAt: Date.now() - LAPSED });
    seed(s);
    store.set('pvp:contended:lock', 'someone-else');
    const kv = (await import('../_storage.js')).kv;
    const result = await enforcePvpTurnDeadline(kv, 'contended', s);
    assert.equal(result.applied, 'none');
    assert.equal(stored('contended').activePlayer, 'p1');
    assert.equal(store.get('pvp:contended:lock'), 'someone-else', 'a foreign lock is never released');
});
