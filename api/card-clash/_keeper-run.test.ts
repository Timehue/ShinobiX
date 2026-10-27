/* Keeper's Path through the REAL keeper-run, ai-start and ai-move handlers over
 * a fake KV: the run seals the deck and the opponent, a duel settles once into
 * the run, a loss costs Resolve, and a forfeit counts as a loss. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { CHRONICLE_FIXED_FALLBACK_DECK } from "../../shared/chronicle-duel.js";
import { KEEPER_PATH_ACTS, KEEPER_PATH_CHRONICLE_POINTS, KEEPER_PATH_RESOLVE, keeperReachableNodes, type KeeperPathRecord } from "../../shared/keeper-path-contract.js";

process.env.ADMIN_PASSWORD = "keeper-test-admin";
process.env.SUPABASE_URL ??= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ??= "x";

const store = new Map<string, unknown>();
const clone = (value: unknown) => (value === undefined || value === null ? null : structuredClone(value));
type Handler = (req: never, res: never) => Promise<unknown>;
let keeperRun: Handler;
let aiStart: Handler;
let aiMove: Handler;

before(async () => {
    const kv = (await import("../_storage.js")).kv as unknown as Record<string, unknown>;
    kv.get = async (key: string) => clone(store.get(key));
    kv.set = async (key: string, value: unknown, options?: { nx?: boolean }) => {
        if (options?.nx && store.has(key)) return null;
        store.set(key, clone(value));
        return "OK";
    };
    kv.compareSet = async (key: string, expected: unknown | null, value: unknown) => {
        const current = store.has(key) ? clone(store.get(key)) : null;
        if (!isDeepStrictEqual(current, expected)) return false;
        store.set(key, clone(value));
        return true;
    };
    kv.del = async (...keys: string[]) => keys.reduce((count, key) => count + (store.delete(key) ? 1 : 0), 0);
    kv.delIfEqual = async (key: string, expected: string) => {
        if (store.get(key) !== expected) return false;
        store.delete(key);
        return true;
    };
    keeperRun = (await import("./keeper-run.js")).default as unknown as Handler;
    aiStart = (await import("./ai-start.js")).default as unknown as Handler;
    aiMove = (await import("./ai-move.js")).default as unknown as Handler;
});

async function call(handler: Handler, body: unknown) {
    const out = { statusCode: 200, body: undefined as never as Record<string, any> };
    const res = { setHeader: () => res, status: (code: number) => { out.statusCode = code; return res; },
        json: (value: unknown) => { out.body = value as never; return res; }, end: () => res };
    await handler({ method: "POST", query: {}, body, headers: { "x-admin-password": "keeper-test-admin", "x-forwarded-for": "10.0.0.11" },
        socket: { remoteAddress: "10.0.0.11" } } as never, res as never);
    return out;
}

const NAME = "pathwalker";
function seed() {
    store.clear();
    store.set(`save:${NAME}`, { character: { name: NAME, ryo: 0, chroniclePoints: 0,
        tileCards: [...CHRONICLE_FIXED_FALLBACK_DECK], cardClashDeck: [...CHRONICLE_FIXED_FALLBACK_DECK] } });
}
const record = () => (store.get(`save:${NAME}`) as { character: { keeperPath: KeeperPathRecord } }).character.keeperPath;

async function startFight() {
    const node = keeperReachableNodes(record().run!).find((entry) => entry.kind !== "shrine")!;
    assert.equal((await call(keeperRun, { playerName: NAME, action: "choose-node", nodeId: node.id })).statusCode, 200);
    const started = await call(aiStart, { playerName: NAME, deck: [], keeperRun: true });
    assert.equal(started.statusCode, 200, JSON.stringify(started.body));
    return { node, matchId: String(started.body.matchId) };
}

function forceTerminal(matchId: string, winner: "p1" | "p2") {
    const session = store.get(`cc-ai:${matchId}`) as { createdAt: number; state: { status: string; winner: string } };
    session.state.status = "complete";
    session.state.winner = winner;
    session.createdAt = Date.now() - 120_000;
    store.set(`cc-ai:${matchId}`, session);
}

test("a run seals the deck, and its duel faces the node's Keeper with the run's boons", async () => {
    seed();
    const started = await call(keeperRun, { playerName: NAME, action: "start" });
    assert.equal(started.statusCode, 200, JSON.stringify(started.body));
    assert.equal(started.body.keeperPath.run.deck.length, 40);
    assert.equal((await call(keeperRun, { playerName: NAME, action: "start" })).statusCode, 409, "one run at a time");
    assert.equal((await call(aiStart, { playerName: NAME, deck: [], keeperRun: true })).statusCode, 409, "a duel needs a chosen node");
    const { node, matchId } = await startFight();
    const session = store.get(`cc-ai:${matchId}`) as { keeperRun: { nodeId: string }; state: { p2: { name: string } } };
    assert.equal(session.keeperRun.nodeId, node.id);
    assert.equal(session.state.p2.name, node.opponent!.name);
});

test("a win clears the node once; a retry of the same duel changes nothing", async () => {
    seed();
    await call(keeperRun, { playerName: NAME, action: "start" });
    const { node, matchId } = await startFight();
    forceTerminal(matchId, "p1");
    const settled = await call(aiMove, { matchId, action: "state" });
    assert.equal(settled.statusCode, 200, JSON.stringify(settled.body));
    assert.equal(settled.body.reward.keeperPath.result, "win");
    assert.equal(record().run!.position, node.id);
    assert.equal(record().run!.wins, 1);
    await call(aiMove, { matchId, action: "state" });
    assert.equal(record().run!.wins, 1);
});

test("beating the last Keeper completes the run: Pathbreaker once, Chronicle Points once a day", async () => {
    seed();
    for (let pass = 0; pass < 2; pass++) {
        if (pass) {
            const save = store.get(`save:${NAME}`) as { character: { keeperPath: KeeperPathRecord } };
            save.character.keeperPath = { ...save.character.keeperPath, run: null };
            store.set(`save:${NAME}`, save);
        }
        assert.equal((await call(keeperRun, { playerName: NAME, action: "start" })).statusCode, 200);
        // Walk straight to the final boss; the map itself is covered in _keeper-path.test.ts.
        const save = store.get(`save:${NAME}`) as { character: { keeperPath: KeeperPathRecord } };
        save.character.keeperPath.run!.current = `a${KEEPER_PATH_ACTS - 1}boss`;
        store.set(`save:${NAME}`, save);
        const started = await call(aiStart, { playerName: NAME, deck: [], keeperRun: true });
        assert.equal(started.statusCode, 200, JSON.stringify(started.body));
        forceTerminal(String(started.body.matchId), "p1");
        const settled = await call(aiMove, { matchId: started.body.matchId, action: "state" });
        assert.equal(settled.body.reward.keeperPath.finished, true);
        assert.equal(settled.body.reward.keeperPath.chroniclePoints, pass ? 0 : KEEPER_PATH_CHRONICLE_POINTS, "paid once per UTC day");
        assert.equal(settled.body.reward.keeperPath.title, pass ? undefined : "Pathbreaker");
    }
    const character = (store.get(`save:${NAME}`) as { character: { chroniclePoints: number; serverTitles: string[]; keeperPath: KeeperPathRecord } }).character;
    assert.equal(character.keeperPath.clears, 2);
    assert.equal(character.chroniclePoints, KEEPER_PATH_CHRONICLE_POINTS);
    assert.deepEqual(character.serverTitles.filter((title) => title === "Pathbreaker"), ["Pathbreaker"]);
});

test("starting again on a node whose duel is still live hands that duel back, at no cost", async () => {
    seed();
    await call(keeperRun, { playerName: NAME, action: "start" });
    const { matchId } = await startFight();
    const again = await call(aiStart, { playerName: NAME, deck: [], keeperRun: true });
    assert.equal(again.statusCode, 200, JSON.stringify(again.body));
    assert.equal(again.body.matchId, matchId, "a lost match id is not a walk-away");
    assert.equal(again.body.resumed, true);
    assert.equal(record().run!.resolve, KEEPER_PATH_RESOLVE);
});

test("a duel left to expire still costs Resolve when the next one is dealt", async () => {
    seed();
    await call(keeperRun, { playerName: NAME, action: "start" });
    const { matchId } = await startFight();
    store.delete(`cc-ai:${matchId}`); // the 2-hour session lease ran out
    const again = await call(aiStart, { playerName: NAME, deck: [], keeperRun: true });
    assert.equal(again.statusCode, 200, JSON.stringify(again.body));
    assert.equal(record().run!.resolve, KEEPER_PATH_RESOLVE - 1, "the expired duel was charged to the run");
});

test("a forfeit that spends the last Resolve ends the run instead of dealing a dead duel", async () => {
    seed();
    await call(keeperRun, { playerName: NAME, action: "start" });
    const first = await startFight();
    forceTerminal(first.matchId, "p2");
    await call(aiMove, { matchId: first.matchId, action: "state" });
    assert.equal(record().run!.resolve, 1);
    const second = await call(aiStart, { playerName: NAME, deck: [], keeperRun: true });
    forceTerminal(String(second.body.matchId), "p2"); // lost, and never claimed
    const refused = await call(aiStart, { playerName: NAME, deck: [], keeperRun: true });
    assert.equal(refused.statusCode, 409);
    assert.match(String(refused.body.error), /run has ended/);
    assert.equal(record().run!.status, "lost");
});

test("a loss and a forfeit each cost one Resolve, and the second ends the run", async () => {
    seed();
    await call(keeperRun, { playerName: NAME, action: "start" });
    const first = await startFight();
    forceTerminal(first.matchId, "p2");
    await call(aiMove, { matchId: first.matchId, action: "state" });
    assert.equal(record().run!.resolve, KEEPER_PATH_RESOLVE - 1);
    assert.equal(record().run!.current, first.node.id, "the same Keeper waits");
    const rematch = await call(aiStart, { playerName: NAME, deck: [], keeperRun: true });
    const forfeited = await call(aiMove, { matchId: rematch.body.matchId, action: "forfeit" });
    assert.equal(forfeited.statusCode, 200, JSON.stringify(forfeited.body));
    assert.equal(record().run!.status, "lost");
    assert.equal(record().best, 0);
});
