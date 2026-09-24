import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'player-ranked-settlement-recovery-secret';
process.env.DISABLE_COMBAT_RECEIPTS = '1';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, any> };
type Store = typeof import('../_storage.js').kv;

// Sorted names: the first of each pair is side `a` and always wins.
const ALPHA = 'rsweepalpha';
const BRAVO = 'rsweepbravo';
const CHARLIE = 'rsweepcharlie';
const DELTA = 'rsweepdelta';
const GATE_KEY = 'ranked:season:authority';
const ELO_WIN = 1012;
const ELO_LOSS = 988;

let kv: Store;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let claimRewards: Handler;
let startRankedSeason: typeof import('../cron/_ranked-season.js').startRankedSeason;
let mintPlayerRankedMatchTokenWithStore: typeof import('../_ranked-match-token.js').mintPlayerRankedMatchTokenWithStore;
let preparation: typeof import('../pet/_ranked-preparation.js');
let journalModule: typeof import('./_player-ranked-journal.js');
let effects: typeof import('./_ranked-terminal-effects.js');
let commitPvpSessionMutation: typeof import('./_session-mutation.js').commitPvpSessionMutation;
let sweep: typeof import('../cron/_player-ranked-settlement-sweep.js');
let SESSION_TTL: number;
let withKvLock: typeof import('../_lock.js').withKvLock;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    claimRewards = (await import('./claim-rewards.js')).default as unknown as Handler;
    ({ startRankedSeason } = await import('../cron/_ranked-season.js'));
    ({ mintPlayerRankedMatchTokenWithStore } = await import('../_ranked-match-token.js'));
    preparation = await import('../pet/_ranked-preparation.js');
    journalModule = await import('./_player-ranked-journal.js');
    effects = await import('./_ranked-terminal-effects.js');
    ({ commitPvpSessionMutation } = await import('./_session-mutation.js'));
    sweep = await import('../cron/_player-ranked-settlement-sweep.js');
    ({ SESSION_TTL } = await import('../combat-core/constants.js'));
    ({ withKvLock } = await import('../_lock.js'));
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.DISABLE_COMBAT_RECEIPTS;
});

function save(name: string, extra: Record<string, unknown> = {}) {
    return {
        _saveVersion: 1,
        character: {
            name,
            level: 25,
            rankedRating: 1000,
            rankedWins: 0,
            rankedLosses: 0,
            profession: 'ninja',
            village: 'Frostfang Village',
            serverSettlementReceipts: [],
            ...extra,
        },
    };
}

beforeEach(async () => {
    for (const pattern of ['ranked:*', 'pvp:*', 'player:ranked-*', 'cron:lease:*', 'lock:*', 'save:*']) {
        for (const key of await kv.keys(pattern)) await kv.del(key);
    }
    await startRankedSeason(Date.now());
    await kv.set(`save:${ALPHA}`, save(ALPHA, {
        profession: 'vanguard', professionRank: 1, professionXp: 0, honorSeals: 0,
    }));
    await kv.set(`save:${BRAVO}`, save(BRAVO));
    await kv.set(`save:${CHARLIE}`, save(CHARLIE));
    await kv.set(`save:${DELTA}`, save(DELTA));
});

const lock = <T>(key: string, action: () => Promise<T>): Promise<T> => withKvLock(key, action, { failClosed: true });
const sealed = async (): Promise<boolean> => { throw new Error('eligibility-must-stay-sealed'); };

let matchCounter = 0;

/**
 * An admitted match whose fight ended `endedAgoMs` ago. The terminal session
 * row is written through the real terminal CAS, which leaves it non-expiring.
 * Nothing after that CAS has run: the worker "died" right after it.
 */
async function endedMatch(
    endedAgoMs = 10 * 60_000,
    [winner, loser] = [ALPHA, BRAVO],
    result: 'p1' | 'draw' = 'p1',
) {
    matchCounter += 1;
    const hex = matchCounter.toString(16).padStart(8, '0');
    const matchId = `player-ranked-${hex}-1234-4123-8123-1234567890ab`;
    const battleId = `pvp-${hex}-1234-4123-8123-1234567890ab`;
    const endedAt = Date.now() - endedAgoMs;
    const createdAt = endedAt - 5 * 60_000;
    await mintPlayerRankedMatchTokenWithStore(kv, {
        a: winner, b: loser, aLevel: 25, bLevel: 25, aRating: 1000, bRating: 1000,
        now: createdAt - 1_000, matchId,
    });
    await preparation.activatePlayerRankedAdmission(kv, matchId, battleId, createdAt);
    const active = {
        battleId,
        p1: { name: winner },
        p2: { name: loser },
        status: 'active',
        winner: null,
        ranked: false,
        rankedKind: 'player',
        playerRankedAuthorityVersion: 2,
        rankedMatchId: matchId,
        rankedSeasonId: 1,
        rankedSeasonEpoch: 1,
        p1Rating: 1000,
        p2Rating: 1000,
        joined: { p1: true, p2: true },
        rewardAuthority: 'ranked',
        baseRewards: false,
        realFighters: { p1: true, p2: true },
        itemCharges: { p1: {}, p2: {} },
        itemsUsed: { p1: {}, p2: {} },
        log: [],
        createdAt,
        lastMoveAt: endedAt,
    } as unknown as import('./session.js').PvpSession;
    const key = `pvp:${battleId}`;
    await kv.set(key, active, { ex: 900 });
    const committed = await commitPvpSessionMutation(kv, key, active, {
        ...active, status: 'done', winner: result, endedAt, lastMoveAt: endedAt,
    });
    assert.equal(committed.status, 'committed');
    return { matchId, battleId, endedAt, session: committed.session };
}

/** Run the real saga until the save CAS for `slug` precommits, then "crash". */
async function crashSagaAtSave(
    session: import('./session.js').PvpSession,
    slug: string,
    options: { eligible?: boolean; now: number },
) {
    let crashed = false;
    const interrupted: Store = {
        ...kv,
        async compareSet(key, expected, value, casOptions) {
            if (key === `save:${slug}` && !crashed) {
                crashed = true;
                throw new Error(`crash-before-${slug}-elo`);
            }
            return kv.compareSet(key, expected, value, casOptions);
        },
    };
    await assert.rejects(effects.confirmPlayerRankedTerminalEffects(interrupted, session, {
        eligible: async () => options.eligible ?? true,
        lock,
        now: options.now,
    }), new RegExp(`crash-before-${slug}-elo`));
}

/** The gate row loses this admission out of band. */
async function dropAdmission(matchId: string) {
    const raw = await kv.get<Record<string, any>>(GATE_KEY);
    assert.ok(raw?.playerAdmissions.some((entry: { matchId: string }) => entry.matchId === matchId));
    const next = { ...raw, playerAdmissions: raw!.playerAdmissions.filter((entry: { matchId: string }) => entry.matchId !== matchId) };
    assert.equal(await kv.compareSet(GATE_KEY, raw, next), true);
}

async function readAt<T>(key: string, at: number): Promise<T | null> {
    const realNow = Date.now;
    Date.now = () => at;
    try {
        return await kv.get<T>(key);
    } finally {
        Date.now = realNow;
    }
}

async function character(slug: string): Promise<Record<string, any>> {
    return ((await kv.get<Record<string, any>>(`save:${slug}`))?.character ?? {}) as Record<string, any>;
}

function request(player: string, body: Record<string, unknown>) {
    return {
        method: 'POST', body, query: {},
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(player), 'x-forwarded-for': '127.0.0.1' },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

async function claim(player: string, battleId: string, outcome: 'win' | 'loss' | 'draw'): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader() { return res; },
        status(code: number) { out.statusCode = code; return res; },
        json(body: Record<string, any>) { out.body = body; return res; },
        end: () => res,
    };
    await claimRewards(request(player, { battleId, playerName: player, outcome, completionVersion: 1 }), res as never);
    return out;
}

/** Every effect of one eligible ALPHA win, landed exactly once. */
async function assertSettledExactlyOnce(matchId: string, battleId: string) {
    const journal = await journalModule.getPlayerRankedJournal(kv, matchId);
    assert.equal(journal?.state, 'completed');
    assert.deepEqual(journal?.confirmations, { a: true, b: true });
    assert.equal(await preparation.getPlayerRankedAdmission(kv, matchId), null);
    assert.equal(await kv.get(journalModule.playerRankedSettlingKey(matchId)), null, 'nothing left for the sweep');
    const winner = await character(ALPHA);
    const loser = await character(BRAVO);
    assert.equal(winner.rankedRating, ELO_WIN);
    assert.equal(winner.rankedWins, 1);
    assert.equal(loser.rankedRating, ELO_LOSS);
    assert.equal(loser.rankedLosses, 1);
    assert.equal(winner.honorSeals, 1, 'one Vanguard seal grant');
    assert.equal(winner.professionXp, 100, 'one Vanguard XP grant');
    assert.equal(winner.elderRankedWinReceipts?.length, 1, 'one council win');
    assert.equal(winner.elderRankedWinReceipts?.[0]?.id, battleId);
    assert.equal(loser.elderRankedWinReceipts, undefined);
}

/** The terminal row carries the ordinary session lease again, not the non-expiring bind. */
async function assertSessionCompacted(battleId: string) {
    assert.ok(await kv.get(`pvp:${battleId}`), 'the settled row stays readable for its compact lease');
    assert.equal(await readAt(`pvp:${battleId}`, Date.now() + (SESSION_TTL + 1) * 1_000), null,
        'the settled terminal row is bounded to the ordinary session lease');
}

test('(a) the sweep finishes a saga cut off right after the terminal session CAS', async () => {
    const { matchId, battleId } = await endedMatch();
    assert.equal((await preparation.getPlayerRankedAdmission(kv, matchId))?.phase, 'active');
    assert.equal(await journalModule.getPlayerRankedJournal(kv, matchId), null);
    assert.equal(await kv.get(journalModule.playerRankedSettlingKey(matchId)), null,
        'nothing but the gate knows this match still owes its settlement');

    const result = await sweep.runPlayerRankedSettlementSweep();

    assert.equal(result.gatePublished, 1);
    assert.deepEqual(result.settled, [matchId]);
    assert.deepEqual(result.failures, []);
    await assertSettledExactlyOnce(matchId, battleId);
    await assertSessionCompacted(battleId);
});

test('(a) the sweep finishes a saga interrupted after the terminal CAS while the admission is held', async () => {
    const { matchId, battleId, endedAt, session } = await endedMatch();
    await crashSagaAtSave(session, BRAVO, { now: endedAt + 1_000 });
    assert.equal((await preparation.getPlayerRankedAdmission(kv, matchId))?.phase, 'terminal');
    assert.deepEqual((await journalModule.getPlayerRankedJournal(kv, matchId))?.confirmations, { a: true, b: false });
    assert.ok(await kv.get(journalModule.playerRankedSettlingKey(matchId)), 'publication left a discovery pointer');
    assert.equal((await character(ALPHA)).rankedRating, ELO_WIN);
    assert.equal((await character(BRAVO)).rankedRating, 1000);

    const result = await sweep.runPlayerRankedSettlementSweep();

    assert.deepEqual(result.settled, [matchId]);
    await assertSettledExactlyOnce(matchId, battleId);
    await assertSessionCompacted(battleId);
});

test('(b) a pending journal whose gate admission is gone settles once, and its session row is bounded', async () => {
    const { matchId, battleId, endedAt, session } = await endedMatch();
    await crashSagaAtSave(session, BRAVO, { now: endedAt + 1_000 });
    await dropAdmission(matchId);
    // The journal predates discovery pointers, like the stuck production row.
    await kv.del(journalModule.playerRankedSettlingKey(matchId));
    assert.ok(await readAt(`pvp:${battleId}`, Date.now() + 30 * 24 * 60 * 60 * 1_000),
        'a player-ranked terminal row never expires on its own before the saga compacts it');
    // Queue traffic only walks the gate, so it can no longer see this match.
    await effects.recoverCompletedPlayerRankedFinalizations(kv, lock);
    assert.equal((await journalModule.getPlayerRankedJournal(kv, matchId))?.state, 'pending');

    const result = await sweep.runPlayerRankedSettlementSweep({ discover: true });

    assert.equal(result.discovery?.published, 1);
    assert.equal(result.discovery?.complete, true);
    assert.deepEqual(result.settled, [matchId]);
    await assertSettledExactlyOnce(matchId, battleId);

    // Every later path replays receipts and grants nothing more.
    const replay = await sweep.runPlayerRankedSettlementSweep({ discover: true });
    assert.deepEqual(replay.settled, []);
    assert.equal(replay.pointers, 0);
    const winnerClaim = await claim(ALPHA, battleId, 'win');
    assert.equal(winnerClaim.statusCode, 200, winnerClaim.body?.error);
    assert.equal(winnerClaim.body?.rating?.value, ELO_WIN);
    const loserClaim = await claim(BRAVO, battleId, 'loss');
    assert.equal(loserClaim.statusCode, 200, loserClaim.body?.error);
    assert.equal(loserClaim.body?.rating?.value, ELO_LOSS);
    assert.equal(loserClaim.body?.rating?.delta, -12);
    await assertSettledExactlyOnce(matchId, battleId);
    await assertSessionCompacted(battleId);
});

test('(b) a claim finishes a pending journal whose admission is gone instead of calling it a no-contest', async () => {
    const { matchId, battleId, endedAt, session } = await endedMatch();
    await crashSagaAtSave(session, BRAVO, { now: endedAt + 1_000 });
    await dropAdmission(matchId);

    const winnerClaim = await claim(ALPHA, battleId, 'win');

    assert.equal(winnerClaim.statusCode, 200, winnerClaim.body?.error);
    assert.doesNotMatch(String(winnerClaim.body?.error ?? ''), /no-contest/i);
    assert.equal(winnerClaim.body?.rating?.value, ELO_WIN);
    await assertSettledExactlyOnce(matchId, battleId);
    await assertSessionCompacted(battleId);
});

test('(b) the scheduler settles the production shape by itself: ineligible, unconfirmed, admission gone', async () => {
    // Mirrors player:ranked-journal:player-ranked-f69d40cb-…: winner a,
    // rankedEligible false, confirmations {a:false,b:false}, no admission,
    // a terminal session row with no TTL, and no discovery pointer.
    const { matchId, battleId, endedAt, session } = await endedMatch();
    await crashSagaAtSave(session, ALPHA, { eligible: false, now: endedAt + 1_000 });
    await dropAdmission(matchId);
    await kv.del(journalModule.playerRankedSettlingKey(matchId));
    const stuck = await journalModule.getPlayerRankedJournal(kv, matchId);
    assert.equal(stuck?.state, 'pending');
    assert.deepEqual(stuck?.confirmations, { a: false, b: false });
    assert.equal(stuck?.terminal.rankedEligible, false);
    assert.equal(stuck?.terminal.winner, 'a');

    const { fireRankedSettlementSweep } = await import('../cron/_scheduler.js');
    await fireRankedSettlementSweep();

    const journal = await journalModule.getPlayerRankedJournal(kv, matchId);
    assert.equal(journal?.state, 'completed');
    assert.equal(await kv.get(journalModule.playerRankedSettlingKey(matchId)), null);
    assert.ok(await kv.get('cron:lease:player-ranked-settlement'), 'the sweep ran under its scheduler lease');
    for (const slug of [ALPHA, BRAVO]) {
        const saved = await character(slug);
        assert.equal(saved.rankedRating, 1000, 'an ineligible terminal never moves Elo');
        assert.equal(saved.rankedWins, 0);
        assert.equal(saved.rankedLosses, 0);
        assert.equal(saved.playerRankedSettlementStamp?.[matchId]?.role, 'ineligible');
        assert.equal(saved.elderRankedWinReceipts, undefined);
    }
    assert.equal((await character(ALPHA)).honorSeals, 0, 'no Vanguard grant for an ineligible terminal');
    await assertSessionCompacted(battleId);
});

test('(c) a claim racing the sweep settles every effect exactly once', async () => {
    const { matchId, battleId } = await endedMatch();

    const [raced, swept] = await Promise.all([
        claim(ALPHA, battleId, 'win'),
        sweep.runPlayerRankedSettlementSweep({ minAgeMs: 0 }),
    ]);

    // Either side may lose a fail-closed save lock to the other; both answers
    // are retryable. Drive each to completion the way a player and the next
    // scheduler tick would.
    let winnerClaim = raced;
    for (let attempt = 0; attempt < 5 && winnerClaim.statusCode !== 200; attempt += 1) {
        winnerClaim = await claim(ALPHA, battleId, 'win');
    }
    assert.equal(winnerClaim.statusCode, 200, winnerClaim.body?.error);
    assert.equal(winnerClaim.body?.rating?.value, ELO_WIN);
    const afterBackoff = Date.now() + 7 * 60 * 60 * 1_000;
    const settledBy = [...swept.settled, ...(await sweep.runPlayerRankedSettlementSweep({
        minAgeMs: 0, now: () => afterBackoff,
    })).settled];
    assert.ok(settledBy.length <= 1, 'the sweep never settles one match twice');
    const loserClaim = await claim(BRAVO, battleId, 'loss');
    assert.equal(loserClaim.statusCode, 200, loserClaim.body?.error);
    assert.equal(loserClaim.body?.rating?.delta, -12);
    await assertSettledExactlyOnce(matchId, battleId);
    await assertSessionCompacted(battleId);
});

test('(c) a whole sweep run inside a paused claim saga still leaves every effect exactly once', async (t) => {
    const { matchId, battleId } = await endedMatch();
    // Pause the claim at its winner Elo write — journal published, gate
    // terminal, nothing credited yet — and run the entire sweep in that gap.
    const original = kv.compareSet;
    let reachedElo!: () => void;
    let resumeClaim!: () => void;
    const claimAtElo = new Promise<void>((resolve) => { reachedElo = resolve; });
    const claimMayContinue = new Promise<void>((resolve) => { resumeClaim = resolve; });
    let paused = false;
    t.mock.method(kv, 'compareSet', async (
        key: string, expected: unknown, value: unknown, options?: { ex?: number },
    ) => {
        if (key === `save:${ALPHA}` && !paused) {
            paused = true;
            reachedElo();
            await claimMayContinue;
        }
        return original(key, expected, value, options);
    });

    const claimed = claim(ALPHA, battleId, 'win');
    await claimAtElo;
    assert.equal((await preparation.getPlayerRankedAdmission(kv, matchId))?.phase, 'terminal');
    const swept = await sweep.runPlayerRankedSettlementSweep({ minAgeMs: 0 });
    assert.deepEqual(swept.settled, [matchId], 'the sweep finishes the saga under the paused claim');
    await assertSettledExactlyOnce(matchId, battleId);

    resumeClaim();
    const winnerClaim = await claimed;
    assert.equal(winnerClaim.statusCode, 200, winnerClaim.body?.error);
    assert.equal(winnerClaim.body?.rating?.value, ELO_WIN);
    assert.equal(winnerClaim.body?.rating?.delta, 12);
    await assertSettledExactlyOnce(matchId, battleId);
    await assertSessionCompacted(battleId);
});

test('the sweep leaves a young terminal to its own saga and backs off a failing one', async () => {
    const fresh = await endedMatch(30_000);
    await crashSagaAtSave(fresh.session, BRAVO, { now: Date.now() });
    const young = await sweep.runPlayerRankedSettlementSweep();
    assert.equal(young.deferred, 1, 'younger than the minimum age: the live saga still owns it');
    assert.deepEqual(young.settled, []);
    assert.equal((await journalModule.getPlayerRankedJournal(kv, fresh.matchId))?.state, 'pending');

    // A stuck match the sweep cannot finish yet (its session row is gone and
    // its journal is still pending) is retried with backoff, not every tick.
    const broken = await endedMatch(10 * 60_000, [CHARLIE, DELTA]);
    await crashSagaAtSave(broken.session, DELTA, { now: broken.endedAt + 1_000 });
    await dropAdmission(broken.matchId);
    await kv.del(`pvp:${broken.battleId}`);
    const later = Date.now() + 4 * 60_000;
    const first = await sweep.runPlayerRankedSettlementSweep({ now: () => later });
    assert.deepEqual(first.settled, [fresh.matchId], 'once old enough, the interrupted saga is finished');
    assert.deepEqual(first.failures.map((failure) => failure.matchId), [broken.matchId]);
    assert.match(first.failures[0].error, /player-ranked-terminal-session-missing/);
    const pointer = journalModule.parsePlayerRankedSettlingPointer(
        await kv.get(journalModule.playerRankedSettlingKey(broken.matchId)),
    );
    assert.equal(pointer?.attempts, 1);
    assert.equal(pointer?.nextAttemptAt, later + sweep.playerRankedSettlementBackoffMs(1));
    const again = await sweep.runPlayerRankedSettlementSweep({ now: () => later + 1_000 });
    assert.equal(again.attempted, 0, 'a failing match waits out its backoff');
    assert.equal(again.deferred, 1);
    assert.equal((await character(BRAVO)).rankedRating, ELO_LOSS, 'the finished match settled the loser once');
    assert.equal((await character(DELTA)).rankedRating, 1000, 'nothing partial is settled without the session');
});

test('a claim for a match with no sealed result is not reported as a season-close no-contest', async () => {
    const { matchId, battleId } = await endedMatch();
    await dropAdmission(matchId);
    const refused = await claim(ALPHA, battleId, 'win');
    assert.equal(refused.statusCode, 409);
    assert.match(String(refused.body?.error), /no recorded result/);
    assert.doesNotMatch(String(refused.body?.error), /season-close/);

    const swept = await sweep.runPlayerRankedSettlementSweep();
    assert.deepEqual(swept.settled, []);
    assert.equal((await character(ALPHA)).rankedRating, 1000);

    // A drawn match answers the same way instead of retrying forever.
    const drawn = await endedMatch(10 * 60_000, [CHARLIE, DELTA], 'draw');
    await dropAdmission(drawn.matchId);
    const drawRefused = await claim(CHARLIE, drawn.battleId, 'draw');
    assert.equal(drawRefused.statusCode, 409, drawRefused.body?.error);
    assert.match(String(drawRefused.body?.error), /no recorded result/);
});
