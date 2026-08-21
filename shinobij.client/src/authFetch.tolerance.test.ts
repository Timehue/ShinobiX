import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
    attachAdminSessionCredential,
    buildSaveVersionEventDetail,
    clearRecoveryAdminSession,
    getSocketAuth,
    setActivePlayer,
    setActiveToken,
    setAdminSession,
    setRecoveryAdminSession,
} from "./authFetch";

/*
 * A brief storage blip must not eject a player from an active fight.
 *
 * Server-side token verification fails CLOSED on any storage error, so a few seconds
 * of Supabase degradation returns 401 to whatever is in flight. The client tolerated
 * only three CONSECUTIVE 401s before dispatching the session-expired event, which
 * renders a blocking, full-screen re-auth modal.
 *
 * The flaw was that a pure count is RATE-dependent: the presence heartbeat fires once
 * per second during combat, so three failures arrived in ~3 seconds and the modal
 * landed mid-battle — while the identical blip on the 20s idle cadence would have gone
 * unnoticed for a minute. The tolerance now also requires the failures to be SUSTAINED
 * for a minimum duration, so it means the same thing on every code path.
 *
 * A genuinely expired token still surfaces immediately (isTokenExpired short-circuits
 * both gates), so this only softens the ambiguous case.
 */

const source = readFileSync(new URL("./authFetch.ts", import.meta.url), "utf8");
const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

/**
 * Run `body` against fresh in-memory sessionStorage AND localStorage. The player
 * identity helpers write to both (sessionStorage is tab-scoped; the localStorage
 * copy is what survives a tab restore), so stubbing only one silently exercises
 * the storage-unavailable path instead of the one under test.
 */
function withStorage(body: () => void): void {
    const previous = (["sessionStorage", "localStorage"] as const)
        .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    for (const [key] of previous) {
        const values = new Map<string, string>();
        const storage: Storage = {
            get length() { return values.size; },
            clear: () => values.clear(),
            getItem: (k) => values.get(k) ?? null,
            key: (index) => [...values.keys()][index] ?? null,
            removeItem: (k) => { values.delete(k); },
            setItem: (k, value) => { values.set(k, String(value)); },
        };
        Object.defineProperty(globalThis, key, { configurable: true, value: storage });
    }
    try {
        body();
    } finally {
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
}

describe("transient 401 tolerance", () => {
    it("clears a tokenless admin fallback before player requests resume", () => {
        const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
        const values = new Map<string, string>();
        const storage: Storage = {
            get length() { return values.size; },
            clear: () => values.clear(),
            getItem: (key) => values.get(key) ?? null,
            key: (index) => [...values.keys()][index] ?? null,
            removeItem: (key) => { values.delete(key); },
            setItem: (key, value) => { values.set(key, String(value)); },
        };
        Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
        try {
            setAdminSession(null, "legacy-admin-password");
            const operatorHeaders = new Headers();
            attachAdminSessionCredential(operatorHeaders);
            assert.equal(operatorHeaders.get("x-admin-password"), "legacy-admin-password");

            setAdminSession(null, null);
            assert.equal(storage.getItem("admin:pw"), null);
            assert.equal(storage.getItem("admin:token"), null);
            const resumedPlayerHeaders = new Headers();
            attachAdminSessionCredential(resumedPlayerHeaders);
            assert.equal(resumedPlayerHeaders.get("x-admin-password"), null);
            assert.equal(resumedPlayerHeaders.get("x-admin-token"), null);
        } finally {
            if (previousStorage) Object.defineProperty(globalThis, "sessionStorage", previousStorage);
            else Reflect.deleteProperty(globalThis, "sessionStorage");
        }
    });

    it("consumes recovery credentials after reload without clearing a normal admin session", () => {
        const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
        const values = new Map<string, string>();
        const storage: Storage = {
            get length() { return values.size; },
            clear: () => values.clear(),
            getItem: (key) => values.get(key) ?? null,
            key: (index) => [...values.keys()][index] ?? null,
            removeItem: (key) => { values.delete(key); },
            setItem: (key, value) => { values.set(key, String(value)); },
        };
        Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
        try {
            assert.equal(setRecoveryAdminSession("recovery-token", "unused-fallback"), true);
            assert.equal(storage.getItem("admin:recovery-session"), "1");
            assert.equal(storage.getItem("admin:token"), "recovery-token");
            assert.equal(clearRecoveryAdminSession(), true, "next boot consumes the recovery-owned credential");
            const resumedPlayerHeaders = new Headers();
            attachAdminSessionCredential(resumedPlayerHeaders);
            assert.equal(resumedPlayerHeaders.get("x-admin-token"), null);
            assert.equal(resumedPlayerHeaders.get("x-admin-password"), null);

            setAdminSession(null, "ordinary-admin-password");
            assert.equal(clearRecoveryAdminSession(), false, "ordinary AdminPanel credentials have no recovery marker");
            const ordinaryAdminHeaders = new Headers();
            attachAdminSessionCredential(ordinaryAdminHeaders);
            assert.equal(ordinaryAdminHeaders.get("x-admin-password"), "ordinary-admin-password");
        } finally {
            if (previousStorage) Object.defineProperty(globalThis, "sessionStorage", previousStorage);
            else Reflect.deleteProperty(globalThis, "sessionStorage");
        }
    });

    it("fails recovery login closed when its ownership marker cannot persist", () => {
        const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
        const values = new Map<string, string>([["admin:pw", "stale-admin-password"]]);
        const storage: Storage = {
            get length() { return values.size; },
            clear: () => values.clear(),
            getItem: (key) => values.get(key) ?? null,
            key: (index) => [...values.keys()][index] ?? null,
            removeItem: (key) => { values.delete(key); },
            setItem: (key, value) => {
                if (key === "admin:recovery-session") throw new Error("storage unavailable");
                values.set(key, String(value));
            },
        };
        Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
        try {
            assert.equal(setRecoveryAdminSession(null, "new-admin-password"), false);
            assert.equal(storage.getItem("admin:recovery-session"), null);
            assert.equal(storage.getItem("admin:pw"), null);
            assert.equal(storage.getItem("admin:token"), null);
            const headers = new Headers();
            attachAdminSessionCredential(headers);
            assert.equal(headers.get("x-admin-password"), null);
            assert.equal(headers.get("x-admin-token"), null);
        } finally {
            if (previousStorage) Object.defineProperty(globalThis, "sessionStorage", previousStorage);
            else Reflect.deleteProperty(globalThis, "sessionStorage");
        }
    });

    it("retains the recovery marker until a partial credential clear can retry", () => {
        const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
        const values = new Map<string, string>();
        let failPasswordRemoval = false;
        const storage: Storage = {
            get length() { return values.size; },
            clear: () => values.clear(),
            getItem: (key) => values.get(key) ?? null,
            key: (index) => [...values.keys()][index] ?? null,
            removeItem: (key) => {
                if (failPasswordRemoval && key === "admin:pw") throw new Error("storage unavailable");
                values.delete(key);
            },
            setItem: (key, value) => { values.set(key, String(value)); },
        };
        Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
        try {
            assert.equal(setRecoveryAdminSession(null, "recovery-password"), true);
            failPasswordRemoval = true;
            assert.equal(clearRecoveryAdminSession(), false);
            assert.equal(storage.getItem("admin:recovery-session"), "1", "marker survives a partial clear");

            failPasswordRemoval = false;
            const resumedPlayerHeaders = new Headers();
            attachAdminSessionCredential(resumedPlayerHeaders);
            assert.equal(storage.getItem("admin:recovery-session"), null, "next request retries the marked cleanup");
            assert.equal(resumedPlayerHeaders.get("x-admin-password"), null);
            assert.equal(resumedPlayerHeaders.get("x-admin-token"), null);
        } finally {
            if (previousStorage) Object.defineProperty(globalThis, "sessionStorage", previousStorage);
            else Reflect.deleteProperty(globalThis, "sessionStorage");
        }
    });

    it("gates the session-expired modal on duration as well as count", () => {
        assert.match(source, /const TRANSIENT_401_TOLERANCE = \d+;/);
        assert.match(source, /const TRANSIENT_401_GRACE_MS = [\d_]+;/);

        // Both conditions must be required together, and a real expiry must still
        // short-circuit them.
        assert.match(
            source,
            /if \(isTokenExpired\(token\) \|\| \(_consecutive401s >= TRANSIENT_401_TOLERANCE && sustained\)\)/,
            "the modal must need BOTH enough failures and a sustained duration",
        );
        assert.doesNotMatch(
            source,
            /if \(isTokenExpired\(token\) \|\| _consecutive401s >= TRANSIENT_401_TOLERANCE\) \{/,
            "the count-only gate is rate-dependent and fires ~3s into a blip during combat",
        );
    });

    it("allows at least ten seconds of degradation before ejecting the player", () => {
        const grace = Number((source.match(/const TRANSIENT_401_GRACE_MS = ([\d_]+);/)?.[1] ?? "0").replace(/_/g, ""));
        assert.ok(
            grace >= 10_000,
            `the grace window is ${grace}ms; a combat heartbeat at 1/s needs >=10s to ride out a storage blip`,
        );
    });

    it("stamps the first failure and clears it on any success", () => {
        // Without the reset, the window would be measured from an ancient unrelated
        // 401 and the duration gate would be satisfied instantly.
        assert.match(source, /if \(_first401At === 0\) _first401At = Date\.now\(\);/);
        assert.match(
            source,
            /_consecutive401s = 0; \/\/ the session demonstrably still works\s*\n\s*_first401At = 0;/,
            "a successful response must clear both the count and the window start",
        );
    });

    it("keeps the no-token password fallback alive in memory only", () => {
        // The documented contract is token-FIRST with a password fallback: when
        // SESSION_SECRET is unset the server issues no token at all. setActivePlayer
        // used to discard its password argument outright, and the interceptor attaches
        // a credential only when one is in hand — so a token-less login "succeeded"
        // into a session where every authenticated request 401s, and a token-less
        // REGISTRATION created a server account whose first save failed.
        assert.match(source, /let _memPassword: string \| null = null;/);
        assert.match(
            source,
            /export function setActivePlayer\(name: string \| null, password\?: string \| null\)/,
            "the password argument must be used, not ignored",
        );
        assert.match(source, /_memPassword = name !== null && typeof password === 'string' && password\.length > 0 \? password : null;/);

        // The fallback must actually reach the wire when there is no token.
        assert.match(
            source,
            /\} else if \(activeName && _memPassword\) \{[\s\S]*?newHeaders\.set\('x-player-password', _memPassword\)/,
            "a token-less session must attach x-player-password",
        );

        // …and the realtime handshake must mirror it, or presence can never connect.
        assert.match(source, /return \{ token: getActiveToken\(\), name: getActivePlayer\(\), password: _memPassword \};/);
    });

    it("an identity-only sync leaves the armed password alone; an explicit null clears it", () => {
        // App.tsx mirrors the active player name into storage from an effect that
        // re-runs on every character change, calling setActivePlayer(name) with no
        // password. That is an identity sync, not a credential change — when it
        // cleared _memPassword it disarmed the fallback moments after a token-less
        // login landed the save, and every request from there on 401'd.
        withStorage(() => {
            setActivePlayer("kaze", "correct-horse");
            assert.equal(getSocketAuth().password, "correct-horse");

            setActivePlayer("kaze");
            assert.equal(getSocketAuth().password, "correct-horse", "the identity mirror must not disarm the fallback");
            setActivePlayer("Kaze");
            assert.equal(getSocketAuth().password, "correct-horse", "…nor must the canonical-casing sync after applyServerSnapshot");

            // A caller that holds a token says so explicitly, and that still clears.
            setActivePlayer("kaze", null);
            assert.equal(getSocketAuth().password, null);
        });
    });

    it("a minted token still supersedes the password, and logout clears both", () => {
        withStorage(() => {
            setActivePlayer("kaze", "correct-horse");
            setActiveToken("session-token");
            assert.equal(getSocketAuth().password, null, "a token must drop the password, so an expiry prompts re-auth");
            assert.equal(getSocketAuth().token, "session-token");

            setActivePlayer("kaze", "correct-horse");
            setActivePlayer(null);
            assert.equal(getSocketAuth().password, null);
            assert.equal(getSocketAuth().token, null);
            assert.equal(getSocketAuth().name, null);
        });
    });

    it("arms the fallback on a token-less login and only on a token-less login", () => {
        // The two halves have to agree: loginPlayerAccount decides from the verdict,
        // enterGameAsPlayer is what actually primes the interceptor. Threading the
        // flag but calling setActivePlayer(name) — or arming unconditionally — each
        // reintroduces one of the two bugs this pairing exists to prevent.
        assert.match(
            appSource,
            /await enterGameAsPlayer\(name, loginLoad, password, \{ armPasswordFallback: !verdict\.token \}\);/,
            "the login must tell enterGameAsPlayer whether the server minted a token",
        );
        assert.match(
            appSource,
            /armPasswordFallback\?: boolean[\s\S]{0,1200}?setActivePlayer\(name, opts\.armPasswordFallback \? password : null\);/,
            "enterGameAsPlayer must arm the password fallback only when no token was minted",
        );
        // Registration is the other token-less door into the same account.
        assert.match(appSource, /setActivePlayer\(newCharacter\.name, regToken \? null : password \?\? null\);/);
    });

    it("never writes the password to durable storage", () => {
        // Hard rule: no durable plaintext password on the client (audit M5). Memory
        // only means a refresh costs a re-login, never a lockout.
        // Two assignment sites: setActivePlayer (which both sets it and, for
        // name === null on logout, clears it) and setActiveToken (token supersedes).
        const assignments = [...source.matchAll(/_memPassword\s*=\s*[^;]+;/g)].map((m) => m[0]);
        assert.equal(assignments.length, 2, `expected exactly the set and clear-on-token sites, got ${assignments.length}`);
        for (const line of assignments) {
            assert.doesNotMatch(line, /Storage/i, `_memPassword must never be persisted: ${line}`);
        }
        // The only storage references to a password are the PURGES of the old durable keys.
        for (const key of ["shinobix:activePassword", "shinobix:activePasswordPersist"]) {
            // Line scan rather than a regex built from the key: the key is a literal
            // and a hand-rolled escaper for it would only be a partial one.
            const uses = source.split(/\r?\n/).filter((line) => line.includes(key));
            for (const use of uses) {
                assert.match(use, /removeItem/, `${key} may only ever be removed, never written`);
            }
        }
        // A token supersedes the password, so the in-memory copy is dropped with it.
        assert.match(source, /_memPassword = null;/);
    });

    it("clears the failure window when a fresh token is adopted", () => {
        // setActiveToken re-arms the one-shot modal latch; the 401 bookkeeping has to
        // reset with it or a new session inherits the old session's failure streak.
        const setter = source.slice(source.indexOf("export function setActiveToken"), source.indexOf("// ── Admin session token"));
        assert.match(setter, /_sessionExpiredNotified = false;/);
        assert.match(setter, /_consecutive401s = 0;/);
        assert.match(setter, /_first401At = 0;/);
    });

    it("tags save-version observations with the request account", () => {
        assert.deepEqual(buildSaveVersionEventDetail({ _saveVersion: 19 }, "Kaya", "mutation"), {
            version: 19, accountName: "Kaya", source: "mutation",
        });
        assert.equal(buildSaveVersionEventDetail({ _saveVersion: 20, character: { name: "Kaya" } }, "Kaya", "mutation"), null,
            "a full character must travel through the atomic character+version commit instead of a split version event");
        assert.equal(buildSaveVersionEventDetail({ _saveVersion: 20.5 }, "Kaya", "mutation"), null);
        assert.equal(buildSaveVersionEventDetail({ _saveVersion: "20" }, "Kaya", "mutation"), null);
        assert.match(source, /function observeSaveVersion\(response: Response, accountName: string \| null, input: RequestInfo \| URL\)/);
        assert.match(source, /new CustomEvent\(SAVE_VERSION_EVENT, \{ detail \}\)/);
        const captures = source.match(/const requestAccountName = newHeaders\.get\('x-player-name'\);/g) ?? [];
        assert.equal(captures.length, 2, "manual and automatically attached player-auth branches both capture identity before awaiting");
        assert.equal((source.match(/requestAccountName, input\)/g) ?? []).length, 2,
            "both auth branches must bind late observations to the request account and URL");
    });
});
