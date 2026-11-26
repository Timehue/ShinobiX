/* Hall Ladder through the REAL ai-start + ai-move handlers, signed in as the
 * player on the isolated memory store: a bout is sealed server-side, only an
 * open bout can be dealt, and only a counted win of the frontier bout moves the
 * ladder. The ladder pays nothing of its own. */
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { CHRONICLE_FIXED_FALLBACK_DECK, STARTING_LIFE_POINTS } from "../../shared/chronicle-duel.js";
import { HALL_LADDER_DUELISTS } from "../../shared/hall-ladder-contract.js";

process.env.NODE_ENV = "test";
process.env.SHINOBIX_QA_MEMORY_KV = "1";
process.env.SESSION_SECRET = "hall-ladder-settle-secret-32-bytes!!";
delete process.env.ENABLE_LEGACY;

type Handler = (req: never, res: never) => Promise<unknown>;
type Reply = { statusCode: number; body: Record<string, unknown> };
type Session = {
    createdAt: number;
    difficulty: string;
    hallLadder?: { bout: number };
    state: { status: string; winner?: string; p2: { name: string; lifePoints: number } };
};

const PLAYER = "ladderer";
let aiStart: Handler;
let aiMove: Handler;
let kv: typeof import("../_storage.js").kv;
let issuePlayerToken: (name: string) => string | null;
let resetRateLimits: () => void;

before(async () => {
    ({ kv } = await import("../_storage.js"));
    ({ issuePlayerToken } = await import("../_auth.js"));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import("../_ratelimit.js"));
    aiStart = (await import("./ai-start.js")).default as unknown as Handler;
    aiMove = (await import("./ai-move.js")).default as unknown as Handler;
});

async function seed(hallLadder?: unknown) {
    const keys = await kv.keys("*");
    if (keys.length) await kv.del(...keys);
    resetRateLimits();
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        character: {
            name: PLAYER, ryo: 0, starterCardsClaimed: true,
            tileCards: [...CHRONICLE_FIXED_FALLBACK_DECK], cardClashDeck: [...CHRONICLE_FIXED_FALLBACK_DECK],
            ...(hallLadder === undefined ? {} : { hallLadder }),
        },
    });
}
beforeEach(() => seed());

after(async () => {
    const keys = await kv.keys("*");
    if (keys.length) await kv.del(...keys);
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function call(handler: Handler, body: Record<string, unknown>): Promise<Reply> {
    const out: Reply = { statusCode: 200, body: {} };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (b: Record<string, unknown>) => { out.body = b; return res; },
        end: () => res,
    };
    await handler({
        method: "POST", query: {}, body,
        headers: { "x-player-name": PLAYER, "x-player-token": issuePlayerToken(PLAYER) ?? "" },
        socket: { remoteAddress: "127.0.0.1" },
    } as never, res as never);
    return out;
}

async function cpOf(): Promise<number> {
    const save = await kv.get<{ character: Record<string, unknown> }>(`save:${PLAYER}`);
    return Number(save?.character.chroniclePoints ?? 0);
}

async function ladderOf(): Promise<unknown> {
    const save = await kv.get<{ character: Record<string, unknown> }>(`save:${PLAYER}`);
    return save?.character.hallLadder;
}

async function start(bout: unknown, extra: Record<string, unknown> = {}) {
    return call(aiStart, { playerName: PLAYER, deck: [], hallLadder: { bout }, ...extra });
}

async function finish(matchId: string, winner: "p1" | "p2", quick = false) {
    const key = `cc-ai:${matchId}`;
    const session = (await kv.get<Session>(key))!;
    session.state.status = "complete";
    session.state.winner = winner;
    session.createdAt = quick ? Date.now() : Date.now() - 120_000;
    await kv.set(key, session);
    return call(aiMove, { matchId, action: "state" });
}

test("the first bout is sealed with the duelist, their difficulty and their deck name", async () => {
    const started = await start(0, { difficulty: "hard" });
    assert.equal(started.statusCode, 200, JSON.stringify(started.body));
    const matchId = started.body.matchId as string;
    const session = (await kv.get<Session>(`cc-ai:${matchId}`))!;
    assert.deepEqual(session.hallLadder, { bout: 0 });
    assert.equal(session.difficulty, "easy", "the bout, not the request, picks the difficulty");
    assert.equal(session.state.p2.name, HALL_LADDER_DUELISTS[0].name);
    assert.equal(session.state.p2.lifePoints, STARTING_LIFE_POINTS);
    const projected = started.body.session as { aiDeckName: string; hallLadderBout?: number };
    assert.equal(projected.aiDeckName, HALL_LADDER_DUELISTS[0].deckName);
    assert.equal(projected.hallLadderBout, 0);
    // A resume (action "state") still names the bout, so the Hall can offer "Next bout".
    const resumed = await call(aiMove, { matchId, action: "state" });
    assert.equal((resumed.body.session as { hallLadderBout?: number }).hallLadderBout, 0);
    // A practice duel names none.
    const practice = await call(aiStart, { playerName: PLAYER, deck: [], difficulty: "easy" });
    assert.equal((practice.body.session as { hallLadderBout?: number }).hallLadderBout, undefined);
});

test("a bout's Health handicap is dealt into the duel", async () => {
    await seed({ cleared: 1 });
    const started = await start(1);
    assert.equal(started.statusCode, 200, JSON.stringify(started.body));
    const session = (await kv.get<Session>(`cc-ai:${started.body.matchId as string}`))!;
    assert.equal(session.state.p2.lifePoints, STARTING_LIFE_POINTS + HALL_LADDER_DUELISTS[0].bouts[1].opponentLifeBonus);
});

test("a locked bout and a malformed envelope are refused before anything is dealt", async () => {
    const locked = await start(1);
    assert.equal(locked.statusCode, 409);
    assert.equal(await kv.get(`cc-ai-active:${PLAYER}`), null);
    for (const bout of [-1, 18, 1.5, "0", null]) {
        assert.equal((await start(bout)).statusCode, 400, `bout ${String(bout)}`);
    }
    assert.equal((await start(0, { externalStakes: true })).statusCode, 400);
    assert.equal((await start(0, { echoes: { encounterId: "echoes-1-tovin" } })).statusCode, 400);
    assert.equal((await start(0, { keeperRun: true })).statusCode, 400);
});

test("a counted win of the frontier bout opens the next one and pays its first-win points, once", async () => {
    const { drainBackgroundWork } = await import("../_background-work.js");
    const started = await start(0);
    const matchId = started.body.matchId as string;
    const settled = await finish(matchId, "p1");
    assert.equal(settled.statusCode, 200, JSON.stringify(settled.body));
    const reward = settled.body.reward as { ryo: number; hallLadder?: unknown };
    assert.deepEqual(reward.hallLadder, { bout: 0, advanced: true, cleared: 1, chroniclePoints: 10 });
    assert.equal(reward.ryo, 0, "the ladder pays no ryo");
    assert.deepEqual(await ladderOf(), { cleared: 1 });
    assert.equal(await cpOf(), 10);
    assert.deepEqual((settled.body.character as Record<string, unknown>).hallLadder, { cleared: 1 });
    assert.equal((settled.body.character as Record<string, unknown>).chroniclePoints, 10);

    const replay = await call(aiMove, { matchId, action: "state" });
    assert.deepEqual((replay.body.reward as { hallLadder?: unknown }).hallLadder, { bout: 0, advanced: true, cleared: 1, chroniclePoints: 10 });
    assert.deepEqual(await ladderOf(), { cleared: 1 }, "a replay does not move it again");
    assert.equal(await cpOf(), 10, "a replay does not pay again");

    // One faucet record per paid bout, none for the replay.
    await drainBackgroundWork();
    type Txn = { txnId: string; player: string; currency: string; delta: number; source: string };
    const txns = ((await kv.get<Txn[]>("econ:txns")) ?? []).filter((txn) => txn.player === PLAYER);
    assert.deepEqual(txns.map(({ txnId, currency, delta, source }) => ({ txnId, currency, delta, source })), [
        { txnId: `hall-ladder:cc-ai:${matchId}`, currency: "chroniclePoints", delta: 10, source: "hall.ladder" },
    ]);

    assert.equal((await start(1)).statusCode, 200, "bout 2 is now open");
});

test("a rematch of a won bout is allowed and moves and pays nothing", async () => {
    await seed({ cleared: 2 });
    const started = await start(0);
    assert.equal(started.statusCode, 200);
    const settled = await finish(started.body.matchId as string, "p1");
    assert.deepEqual((settled.body.reward as { hallLadder?: unknown }).hallLadder, { bout: 0, advanced: false, cleared: 2, chroniclePoints: 0 });
    assert.deepEqual(await ladderOf(), { cleared: 2 });
    assert.equal(await cpOf(), 0);
});

test("beating a duelist pays 30 and beating the champion pays 60", async () => {
    await seed({ cleared: 2 });
    const duelist = await start(2);
    const beaten = await finish(duelist.body.matchId as string, "p1");
    assert.equal((beaten.body.reward as { hallLadder: { chroniclePoints: number } }).hallLadder.chroniclePoints, 30);
    assert.equal(await cpOf(), 30);

    await seed({ cleared: 17 });
    const champion = await start(17);
    const crowned = await finish(champion.body.matchId as string, "p1");
    assert.deepEqual((crowned.body.reward as { hallLadder?: unknown }).hallLadder, { bout: 17, advanced: true, cleared: 18, chroniclePoints: 60 });
    assert.equal(await cpOf(), 60);
});

test("a loss, a forfeit and a too-quick win leave the ladder where it was", async () => {
    const lost = await start(0);
    await finish(lost.body.matchId as string, "p2");
    assert.equal(await ladderOf(), undefined);
    assert.equal(await cpOf(), 0);

    const quick = await start(0);
    const quickSettle = await finish(quick.body.matchId as string, "p1", true);
    assert.equal((quickSettle.body.reward as { hallLadder?: unknown }).hallLadder, undefined);
    assert.equal(await ladderOf(), undefined);

    const walked = await start(0);
    await call(aiMove, { matchId: walked.body.matchId as string, action: "forfeit" });
    assert.equal(await ladderOf(), undefined);
    assert.equal(await cpOf(), 0, "no points for a loss, a quick win or a forfeit");
});

test("a client save cannot write its own ladder progress", async () => {
    const { SERVER_MIRRORED_CHARACTER_FIELDS } = await import("../save/_state-ownership.js");
    assert.ok((SERVER_MIRRORED_CHARACTER_FIELDS as readonly string[]).includes("hallLadder"));
});
