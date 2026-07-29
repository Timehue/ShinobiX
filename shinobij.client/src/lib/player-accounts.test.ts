import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { accountKey, loadPlayerAccounts, savePlayerAccounts } from "./player-accounts";
import { PLAYER_ACCOUNTS_STORAGE } from "../constants/game";

// These helpers were drained out of App.tsx. The reason they get tests now: they
// carry a load-bearing security invariant for the token-first auth model — a
// reusable password must never survive in localStorage. Two independent halves
// enforce it (a scrub on read, a strip on write), so both are pinned here.

function installLocalStorage(seed: Record<string, string> = {}) {
    const store = new Map(Object.entries(seed));
    const mock = {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
        removeItem: (k: string) => { store.delete(k); },
        clear: () => { store.clear(); },
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() { return store.size; },
    };
    (globalThis as unknown as { localStorage: unknown }).localStorage = mock;
    return store;
}

beforeEach(() => { installLocalStorage(); });

test("accountKey normalises case and surrounding whitespace", () => {
    assert.equal(accountKey("  Kaida  "), "kaida");
    assert.equal(accountKey("KAIDA"), "kaida");
    // Same player typed three ways must collide onto one key, or a duplicate
    // account can be created alongside the real one.
    assert.equal(accountKey("Kaida"), accountKey(" kaida "));
});

test("loadPlayerAccounts scrubs a persisted password left by an older build", () => {
    const store = installLocalStorage({
        [PLAYER_ACCOUNTS_STORAGE]: JSON.stringify({
            kaida: { token: "t1", password: "hunter2" },
            rill: { token: "t2" },
        }),
    });

    const accounts = loadPlayerAccounts();

    assert.ok(!("password" in (accounts.kaida as object)), "password must be scrubbed from the returned object");
    assert.equal(accounts.kaida.token, "t1", "the token must survive the scrub");
    assert.equal(accounts.rill.token, "t2");
    // and it must be rewritten to storage, not just hidden from this caller
    assert.ok(!store.get(PLAYER_ACCOUNTS_STORAGE)!.includes("hunter2"), "scrub must persist back to localStorage");
});

test("loadPlayerAccounts leaves storage untouched when nothing needed scrubbing", () => {
    const clean = JSON.stringify({ kaida: { token: "t1" } });
    const store = installLocalStorage({ [PLAYER_ACCOUNTS_STORAGE]: clean });
    loadPlayerAccounts();
    assert.equal(store.get(PLAYER_ACCOUNTS_STORAGE), clean);
});

test("loadPlayerAccounts returns {} for missing or corrupt storage", () => {
    assert.deepEqual(loadPlayerAccounts(), {});
    installLocalStorage({ [PLAYER_ACCOUNTS_STORAGE]: "{not json" });
    assert.deepEqual(loadPlayerAccounts(), {}, "corrupt JSON must not throw into the caller");
});

test("savePlayerAccounts strips password, snapshot and inline base64 images", () => {
    const store = installLocalStorage();
    savePlayerAccounts({
        kaida: {
            token: "t1",
            // deliberately shaped like a caller that still had these fields in hand
            ...({ password: "hunter2" } as object),
            snapshot: { character: { avatar: "data:image/png;base64,AAAA" } } as never,
        },
    });

    const raw = store.get(PLAYER_ACCOUNTS_STORAGE)!;
    assert.ok(!raw.includes("hunter2"), "password must never be written to localStorage");
    assert.ok(!raw.includes("snapshot"), "snapshot is dropped on write");
    assert.ok(!raw.includes("base64"), "inline images must not be persisted");
    assert.ok(raw.includes("t1"), "the session token is what we DO keep");
});

test("savePlayerAccounts swallows quota errors rather than breaking the caller", () => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
        getItem: () => null,
        setItem: () => { throw new Error("QuotaExceededError"); },
    };
    // Server KV is the source of truth, so a full disk must not surface as a crash.
    assert.doesNotThrow(() => savePlayerAccounts({ kaida: { token: "t1" } }));
});

test("a round-trip keeps the token and drops the password", () => {
    savePlayerAccounts({ kaida: { token: "abc" } });
    const back = loadPlayerAccounts();
    assert.deepEqual(back, { kaida: { token: "abc" } });
});
