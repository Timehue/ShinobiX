import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

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

describe("transient 401 tolerance", () => {
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
            const uses = [...source.matchAll(new RegExp(`.*${key.replace(/[:]/g, "\\$&")}.*`, "g"))].map((m) => m[0]);
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
});
