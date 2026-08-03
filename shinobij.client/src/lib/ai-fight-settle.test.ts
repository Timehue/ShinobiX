import { strict as assert } from "node:assert";
import test, { beforeEach, afterEach } from "node:test";

// lib/world-state reaches for localStorage at call time (sector territory lives
// there). Give it an in-memory one before importing anything that pulls it in.
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
};

const { settleAiFight, shouldSettleOnClose } = await import("./ai-fight-settle");
const { requestAiFight } = await import("./ai-fight-request");

type Call = { url: string; body: Record<string, unknown> };
let calls: Call[] = [];
let respond: () => { ok: boolean; payload: unknown };
const realFetch = globalThis.fetch;

function win(extra: Record<string, unknown> = {}) {
    return { ok: true, payload: { ok: true, outcome: "win", xp: 0, ryo: 75, capped: false, character: { name: "Rill", ryo: 75 }, ...extra } };
}

beforeEach(() => {
    calls = [];
    store.clear();
    respond = win;
    (globalThis as Record<string, unknown>).fetch = async (url: string, init?: { body?: string }) => {
        calls.push({ url: String(url), body: JSON.parse(init?.body ?? "{}") });
        const { ok, payload } = respond();
        return { ok, json: async () => payload } as unknown as Response;
    };
});

afterEach(() => { (globalThis as Record<string, unknown>).fetch = realFetch; });

function hookSpy() {
    const fired: string[] = [];
    return {
        fired,
        hooks: {
            onSectorRaidDamage: (sector: number) => fired.push(`damage:${sector}`),
            onMissionRaidComplete: (sector: number) => fired.push(`raid:${sector}`),
            onExploreAmbushWon: () => fired.push("explore"),
            onHuntBeastDefeated: (id: string) => fired.push(`hunt:${id}`),
        },
    };
}

test("the settle asks for an outcome — it never asserts one", async () => {
    await settleAiFight({ playerName: "Rill", token: "tok", opponentId: "ai-thug", battleKind: "raidAi", sector: 4 });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /report-ai-fight$/);
    assert.deepEqual(Object.keys(calls[0].body).sort(), ["aiFightToken", "playerName"],
        "the body must carry ONLY the token — no amount, no outcome, nothing to inflate");
});

test("a practice bout still settles, so a practice defeat costs the same hospital stay", async () => {
    // The server decides practice pays nothing; the client must NOT skip the
    // call, or losing a practice bout would be free while losing a raid is not.
    const spy = hookSpy();
    respond = () => win({ ryo: 0 });
    const result = await settleAiFight({
        playerName: "Rill", token: "tok", opponentId: "ai-dummy", battleKind: "practice", hooks: spy.hooks,
    });
    assert.equal(calls.length, 1, "practice must still reach the server");
    assert.equal(result.ryo, 0);
    assert.deepEqual(spy.fired, [], "practice fires no world side effects");
});

test("a raid win fires the raid + hunt side effects", async () => {
    const spy = hookSpy();
    const result = await settleAiFight({
        playerName: "Rill", token: "tok", opponentId: "ai-hunt-beast", battleKind: "raidAi", sector: 41, hooks: spy.hooks,
    });
    assert.equal(result.settled, true);
    assert.equal(result.outcome, "win");
    assert.equal(result.ryo, 75, "the announced reward is the server's number, not a prediction");
    assert.deepEqual(spy.fired, ["damage:41", "raid:41", "hunt:ai-hunt-beast"]);
});

test("an explore ambush win fires ONLY the explore credit", async () => {
    const spy = hookSpy();
    await settleAiFight({
        playerName: "Rill", token: "tok", opponentId: "ai-bandit", battleKind: "explore", sector: 7, hooks: spy.hooks,
    });
    assert.deepEqual(spy.fired, ["explore"], "an ambush is not a raid — no territory damage, no hunt credit");
});

test("a field-mission win folds the daily-mission counter onto the settled character", async () => {
    respond = () => win({ character: { name: "Rill", totalMissionsCompleted: 3 } });
    const result = await settleAiFight({
        playerName: "Rill", token: "tok", opponentId: "ai-thug", battleKind: "mission",
    });
    assert.equal(result.character?.totalMissionsCompleted, 4, "markMissionCompleted applies on top of the server character");
});

test("a LOSS burns no progress but still returns the hospitalized character", async () => {
    const spy = hookSpy();
    respond = () => ({ ok: true, payload: { ok: true, outcome: "loss", xp: 0, ryo: 0, character: { name: "Rill", hp: 0, hospitalized: true } } });
    const result = await settleAiFight({
        playerName: "Rill", token: "tok", opponentId: "ai-hunt-beast", battleKind: "raidAi", sector: 41, hooks: spy.hooks,
    });
    assert.equal(result.outcome, "loss");
    assert.equal(result.character?.hospitalized, true, "the defeat must reach the character or losing costs nothing");
    assert.deepEqual(spy.fired, [], "a defeat must not consume the accepted hunt or raid");
    assert.equal(result.character?.totalMissionsCompleted, undefined);
});

test("a FORFEIT is reported as such and grants nothing", async () => {
    const spy = hookSpy();
    respond = () => ({ ok: true, payload: { ok: true, outcome: "forfeit", xp: 0, ryo: 0, character: { name: "Rill", hp: 0, hospitalized: true } } });
    const result = await settleAiFight({
        playerName: "Rill", token: "tok", opponentId: "ai-thug", battleKind: "raidAi", sector: 2, hooks: spy.hooks,
    });
    assert.equal(result.outcome, "forfeit");
    assert.equal(result.ryo, 0);
    assert.deepEqual(spy.fired, []);
});

test("an unverifiable settle THROWS so the arena shell's retry engages", async () => {
    // The shell wraps settleFn in a 4x backoff retry and only then offers a
    // manual Retry button. Resolving quietly made all of that dead code: one
    // dropped request on a WIN showed "no reward was granted" while the token sat
    // unspent, with nothing the player could do about it.
    respond = () => ({ ok: false, payload: { error: 'The sealed fight could not be verified.' } });
    const spy = hookSpy();
    await assert.rejects(
        settleAiFight({ playerName: "Rill", token: "tok", opponentId: "ai-hunt-beast", battleKind: "raidAi", sector: 41, hooks: spy.hooks }),
        /could not be settled/,
    );
    assert.deepEqual(spy.fired, [], "a settle that never landed must burn no hunt or raid progress");
});

test("a network failure throws too — retrying is safe because the token is single-use", async () => {
    (globalThis as Record<string, unknown>).fetch = async () => { throw new Error("offline"); };
    await assert.rejects(
        settleAiFight({ playerName: "Rill", token: "tok", opponentId: "ai-thug", battleKind: "raidAi", sector: 3 }),
        /could not be settled/,
    );
});

test("leaving an unresolved fight forfeits it — closing is not an escape hatch", () => {
    // The free-retry hole. A player about to lose must not be able to close the
    // screen and take no damage; the server scores an abandoned run a forfeit,
    // but only if the client actually settles it on the way out.
    assert.equal(shouldSettleOnClose(true, false), true, "an unsettled fight must settle on close");
    assert.equal(shouldSettleOnClose(true, true), false, "an already-settled fight must not settle twice");
    assert.equal(shouldSettleOnClose(false, false), false, "no fight, nothing to settle");
});

test("the bus accepts exactly the battle kinds the token record recognises", () => {
    // A kind createAiFightTokenRecord does not recognise silently degrades to
    // 'practice' server-side, which pays nothing — so a typo here would quietly
    // zero out a reward instead of failing.
    for (const battleKind of ["practice", "mission", "raidAi", "defense", "explore", "endless"] as const) {
        assert.equal(requestAiFight({ opponentId: "x", opponentLevel: 1, battleKind, playLocally: () => {} }), false);
    }
});
