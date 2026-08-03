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

const { settleAiFightWin } = await import("./ai-fight-settle");
const { requestAiFight } = await import("./ai-fight-request");

type Call = { url: string; body: Record<string, unknown> };
let calls: Call[] = [];
let respond: () => { ok: boolean; payload: unknown };
const realFetch = globalThis.fetch;

beforeEach(() => {
    calls = [];
    store.clear();
    respond = () => ({ ok: true, payload: { ok: true, xp: 0, ryo: 75, capped: false, character: { name: "Rill", ryo: 75 } } });
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

test("a practice bout reports nothing and grants nothing", async () => {
    const spy = hookSpy();
    const result = await settleAiFightWin({
        playerName: "Rill", token: "tok", opponentId: "ai-dummy", battleKind: "practice", hooks: spy.hooks,
    });
    assert.equal(calls.length, 0, "practice must never reach report-ai-fight");
    assert.equal(result.paid, false);
    assert.equal(result.ryo, 0);
    assert.deepEqual(spy.fired, [], "practice fires no world side effects");
});

test("a raid win redeems the token and fires the raid + hunt side effects", async () => {
    const spy = hookSpy();
    const result = await settleAiFightWin({
        playerName: "Rill", token: "tok", opponentId: "ai-hunt-beast", battleKind: "raidAi", sector: 41, hooks: spy.hooks,
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /report-ai-fight$/);
    assert.equal(calls[0].body.aiFightToken, "tok");
    // The reward is paid from the SEALED token — the body must carry no amount.
    assert.equal(calls[0].body.ryo, undefined, "the client must not send a reward amount");
    assert.equal(calls[0].body.xp, undefined, "the client must not send a reward amount");
    assert.equal(result.paid, true);
    assert.equal(result.ryo, 75, "the announced reward is the server's number, not a prediction");
    assert.deepEqual(spy.fired, ["damage:41", "raid:41", "hunt:ai-hunt-beast"]);
});

test("an explore ambush win fires ONLY the explore credit", async () => {
    const spy = hookSpy();
    await settleAiFightWin({
        playerName: "Rill", token: "tok", opponentId: "ai-bandit", battleKind: "explore", sector: 7, hooks: spy.hooks,
    });
    assert.deepEqual(spy.fired, ["explore"], "an ambush is not a raid — no territory damage, no hunt credit");
});

test("a field-mission win folds the daily-mission counter onto the paid character", async () => {
    respond = () => ({ ok: true, payload: { ok: true, xp: 0, ryo: 75, character: { name: "Rill", totalMissionsCompleted: 3 } } });
    const spy = hookSpy();
    const result = await settleAiFightWin({
        playerName: "Rill", token: "tok", opponentId: "ai-thug", battleKind: "mission", hooks: spy.hooks,
    });
    assert.equal(result.character?.totalMissionsCompleted, 4, "markMissionCompleted must apply on top of the server character");
    assert.deepEqual(spy.fired, [], "a field mission fires no world side effects");
});

test("a refused report burns NO hunt or raid progress", async () => {
    respond = () => ({ ok: false, payload: { error: "AI fight token is invalid or already spent." } });
    const spy = hookSpy();
    const result = await settleAiFightWin({
        playerName: "Rill", token: "tok", opponentId: "ai-hunt-beast", battleKind: "raidAi", sector: 41, hooks: spy.hooks,
    });
    assert.equal(result.paid, false);
    assert.equal(result.ryo, 0);
    assert.deepEqual(spy.fired, [], "a refused win must not consume the accepted hunt or raid");
});

test("a network failure resolves as unpaid rather than throwing into the result card", async () => {
    (globalThis as Record<string, unknown>).fetch = async () => { throw new Error("offline"); };
    const result = await settleAiFightWin({
        playerName: "Rill", token: "tok", opponentId: "ai-thug", battleKind: "raidAi", sector: 3,
    });
    assert.equal(result.paid, false);
});

test("the bus and the settle agree on the battle kinds the server seals", () => {
    // A kind the token record does not recognise silently degrades to 'practice'
    // server-side (createAiFightTokenRecord), which pays nothing — so a typo here
    // would quietly zero out a reward instead of failing.
    for (const battleKind of ["practice", "mission", "raidAi", "defense", "explore", "endless"] as const) {
        assert.equal(requestAiFight({ opponentId: "x", opponentLevel: 1, battleKind, playLocally: () => {} }), false);
    }
});
