import { afterEach, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import type { Achievement } from "../constants/achievements";
import type { Character } from "../types/character";
import { createAchievementSyncGate, type AchievementSyncGate } from "./achievement-sync.js";
import {
    loadAchievementCatalog,
    runAchievementSyncPass,
    type AchievementCatalog,
    type AchievementSyncPassInput,
} from "./achievement-sync-pass.js";
import { unseenAchievements } from "./achievement-toast-ledger.js";

const achievement = (id: string, check: (c: Character) => boolean = () => true): Achievement => ({
    id, name: id, desc: "", category: "Combat", icon: "", check,
});

const FIRST_BLOOD = achievement("first-blood");
const CATALOG: AchievementCatalog = {
    ACHIEVEMENTS: [FIRST_BLOOD, achievement("never-earned", () => false)],
    titlesForAchievementIds: () => [],
};

// Shaped like Chromium's rejection in the 2026-09-13 e2e run. Firefox and
// WebKit word it differently; the pass must not care which.
const chunkFailure = () => Promise.reject(new TypeError(
    "Failed to fetch dynamically imported module: http://127.0.0.1:4173/assets/c-3f9a1b2c.js",
));

const character = (over: Record<string, unknown> = {}) =>
    ({ name: "Rill", unlockedAchievements: [], earnedTitles: [], ...over }) as unknown as Character;

function pass(over: Partial<AchievementSyncPassInput> = {}) {
    const committed: Array<{ character: Character; version: unknown }> = [];
    const toasted: Achievement[][] = [];
    const subject = over.character ?? character();
    const input: AchievementSyncPassInput = {
        playerName: "Rill",
        character: subject,
        gate: createAchievementSyncGate(),
        isCancelled: () => false,
        characterRef: { current: subject },
        commitVersionedCharacter: (next, version) => { committed.push({ character: next, version }); return true; },
        onToasts: (list) => { toasted.push(list); },
        loadCatalog: async () => CATALOG,
        ...over,
    };
    return { input, committed, toasted };
}

const syncReply = (unlocked: string[], newlyUnlocked: string[] = unlocked) => new Response(JSON.stringify({
    _saveVersion: 7,
    character: { unlockedAchievements: unlocked, achievementUnlockedAt: {}, earnedTitles: [], ryo: 150, fateShards: 0 },
    newlyUnlocked,
}), { status: 200, headers: { "Content-Type": "application/json" } });

const untouchedGate = (): AchievementSyncGate => createAchievementSyncGate();

let fetchCalls: Array<{ url: string; body: unknown }> = [];
let nextReply: () => Response | Promise<Response> = () => syncReply([]);
const realFetch = globalThis.fetch;
// Saved by descriptor so restoring it never trips a runtime's own storage getter.
const realStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

beforeEach(() => {
    fetchCalls = [];
    nextReply = () => syncReply([]);
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        fetchCalls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return nextReply();
    }) as typeof fetch;
    // The toast ledger only needs getItem/setItem.
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        writable: true,
        value: {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
        },
    });
});

afterEach(() => {
    globalThis.fetch = realFetch;
    if (realStorage) Object.defineProperty(globalThis, "localStorage", realStorage);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("runAchievementSyncPass: a catalog chunk that fails to load", () => {
    it("resolves quietly, never asks the server, and leaves the gate unclaimed", async () => {
        // App fires the pass as `void runAchievementSyncPass(...)`, so a
        // rejection here would go unhandled, and Playwright records that as a
        // `pageerror`.
        const { input, committed, toasted } = pass({ loadCatalog: chunkFailure });
        await assert.doesNotReject(runAchievementSyncPass(input));
        assert.equal(fetchCalls.length, 0);
        assert.deepEqual(input.gate, untouchedGate(), "a failed load must not record a signature");
        assert.deepEqual(committed, []);
        assert.deepEqual(toasted, []);
    });

    it("REGRESSION: the next pass loads again and syncs what the failed pass skipped", async () => {
        // The gate refuses a divergence it has already seen. Had the failed pass
        // claimed it before loading the catalog, this retry would be refused and
        // the unlock would wait for a page reload.
        const gate = createAchievementSyncGate();
        await runAchievementSyncPass(pass({ gate, loadCatalog: chunkFailure }).input);

        nextReply = () => syncReply(["first-blood"]);
        const retry = pass({ gate });
        await runAchievementSyncPass(retry.input);

        assert.deepEqual(fetchCalls, [{ url: "/api/achievements/sync", body: { playerName: "Rill" } }]);
        assert.equal(retry.committed.length, 1);
        assert.deepEqual(retry.toasted, [[FIRST_BLOOD]]);
        assert.equal(gate.inFlight, false, "the request settled, so the gate is released");
    });

    it("does nothing once the effect that started it has been cleaned up", async () => {
        const { input, committed } = pass({ isCancelled: () => true });
        await runAchievementSyncPass(input);
        assert.equal(fetchCalls.length, 0);
        assert.deepEqual(input.gate, untouchedGate());
        assert.deepEqual(committed, []);
    });
});

describe("runAchievementSyncPass: once the catalog has loaded", () => {
    it("adopts the reply through the atomic character+version commit", async () => {
        // The player kept playing while the request was in flight. Only the
        // server-owned fields may change, and the version must travel with them.
        const live = character({ pendingLocalChoice: "unrelated live progress" });
        nextReply = () => syncReply(["first-blood"]);
        const { input, committed } = pass({ characterRef: { current: live } });
        await runAchievementSyncPass(input);

        assert.equal(committed.length, 1);
        assert.equal(committed[0].version, 7);
        const adopted = committed[0].character as Character & { pendingLocalChoice?: string };
        assert.deepEqual(adopted.unlockedAchievements, ["first-blood"]);
        assert.equal(adopted.ryo, 150);
        assert.equal(adopted.pendingLocalChoice, "unrelated live progress");
    });

    it("keeps the first-ever sync silent and records its unlocks as already seen", async () => {
        // The server treats the first sync as a backfill that pays nothing, so
        // popping toasts for existing progress would be misleading.
        nextReply = () => syncReply(["first-blood"]);
        const { input, toasted } = pass({ character: character({ unlockedAchievements: undefined }) });
        await runAchievementSyncPass(input);

        assert.equal(fetchCalls.length, 1);
        assert.deepEqual(toasted, []);
        assert.deepEqual(unseenAchievements("Rill", ["first-blood"]), []);
    });

    it("swallows a request that fails offline and releases the gate", async () => {
        nextReply = () => { throw new TypeError("Failed to fetch"); };
        const { input, committed } = pass();
        await assert.doesNotReject(runAchievementSyncPass(input));
        assert.equal(fetchCalls.length, 1);
        assert.equal(input.gate.inFlight, false);
        assert.deepEqual(committed, []);
    });

    it("does not re-send the same divergence after the server fails", async () => {
        // Unlike a failed catalog load, a failed request reached the server, so
        // it keeps its signature. Retrying it at once was the save-churn loop.
        const gate = createAchievementSyncGate();
        nextReply = () => new Response("nope", { status: 500 });
        await runAchievementSyncPass(pass({ gate }).input);
        await runAchievementSyncPass(pass({ gate }).input);

        assert.equal(fetchCalls.length, 1, "the gate allows one request per distinct divergence");
        assert.equal(gate.inFlight, false);
    });

    it("rejects a reply for a different player", async () => {
        nextReply = () => syncReply(["first-blood"]);
        const { input, committed, toasted } = pass({ characterRef: { current: character({ name: "SomeoneElse" }) } });
        await runAchievementSyncPass(input);
        assert.deepEqual(committed, []);
        assert.deepEqual(toasted, []);
    });
});

describe("loadAchievementCatalog", () => {
    it("uses a plain import(), with no retry wrapper and no timeout", () => {
        // retryDynamicImport's per-attempt timeout would give up on a slow chunk
        // that later lands, and its retry cannot rescue a failed one (see the
        // module comment). This is a source check because a mocked module would
        // hide exactly that difference.
        const source = readFileSync(new URL("./achievement-sync-pass.ts", import.meta.url), "utf8");
        const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
        const imports = code.split(/\r?\n/).filter((line) => /(^|[^a-zA-Z_$.])import\(/.test(line));
        assert.deepEqual(imports.map((line) => line.trim()), ['return import("../constants/achievements");']);
        assert.doesNotMatch(code, /retryDynamicImport|setTimeout/);
    });

    it("resolves the real catalog", async () => {
        const catalog = await loadAchievementCatalog();
        assert.ok(catalog.ACHIEVEMENTS.length > 0);
        assert.ok(catalog.ACHIEVEMENTS.every((entry) => typeof entry.check === "function"));
        assert.equal(typeof catalog.titlesForAchievementIds, "function");
    });
});
