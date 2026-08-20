import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { accountKey, forgetAccountToken, loadPlayerAccounts, rememberedShinobi, savePlayerAccounts } from "./player-accounts";
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

// ── "Continue as" chips ─────────────────────────────────────────────────────
// The gate offers a one-press return for every account holding a token. A token
// that has already expired is not a way back in: pressing its chip re-installed
// the dead credential, the save GET came back 401, and App reported that as
// "No save found for that name" — which reads as the character being deleted.
// These pin the two halves of the fix: never offer a dead token, and forget one
// the moment the server proves it dead.

/** A token shaped like the real thing: `v2.<name>.<expMs>.<epoch>.<sig>`. */
function tokenExpiring(atMs: number) {
    return `v2.kaida.${atMs}.1.sig`;
}

test("rememberedShinobi offers a live token and hides an expired one", () => {
    installLocalStorage({
        [PLAYER_ACCOUNTS_STORAGE]: JSON.stringify({
            kaida: { token: tokenExpiring(Date.now() + 60_000) },
            rill: { token: tokenExpiring(Date.now() - 60_000) },
        }),
    });

    assert.deepEqual(rememberedShinobi(), [{ name: "kaida", guest: false }]);
});

test("rememberedShinobi still offers a guest whose token lapsed", () => {
    // A guest's resume credential outlives the 24h token by two weeks, so their
    // chip stays pressable long after the token behind it dies.
    installLocalStorage({
        "shinobix:guestName": "rill",
        [PLAYER_ACCOUNTS_STORAGE]: JSON.stringify({
            rill: { token: tokenExpiring(Date.now() - 60_000) },
        }),
    });

    assert.deepEqual(rememberedShinobi(), [{ name: "rill", guest: true }]);
});

test("rememberedShinobi keeps a token it cannot read an expiry from", () => {
    // Unrecognised shape means "unknown", not "dead". Guessing dead would strip
    // a working credential and force a password the account may not even have.
    installLocalStorage({
        [PLAYER_ACCOUNTS_STORAGE]: JSON.stringify({ kaida: { token: "opaque" } }),
    });

    assert.deepEqual(rememberedShinobi(), [{ name: "kaida", guest: false }]);
});

test("forgetAccountToken drops only that account's token", () => {
    installLocalStorage({
        [PLAYER_ACCOUNTS_STORAGE]: JSON.stringify({ kaida: { token: "t1" }, rill: { token: "t2" } }),
    });

    forgetAccountToken("  KAIDA  ");

    const accounts = loadPlayerAccounts();
    assert.equal(accounts.kaida.token, undefined, "the dead token must be gone");
    assert.ok("kaida" in accounts, "the account entry itself survives");
    assert.equal(accounts.rill.token, "t2", "other accounts are untouched");
});

test("forgetAccountToken is a no-op for an unknown or empty name", () => {
    const store = installLocalStorage({
        [PLAYER_ACCOUNTS_STORAGE]: JSON.stringify({ kaida: { token: "t1" } }),
    });
    const before = store.get(PLAYER_ACCOUNTS_STORAGE);

    forgetAccountToken("nobody");
    forgetAccountToken("   ");

    assert.equal(store.get(PLAYER_ACCOUNTS_STORAGE), before);
});
