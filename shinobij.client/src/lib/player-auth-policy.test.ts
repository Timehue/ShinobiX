import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
    PLAYER_NAME_MAX_LENGTH,
    PLAYER_PASSWORD_MAX_LENGTH,
    authRateLimitMessage,
    playerNamePolicyError,
    playerPasswordPolicyError,
    requiresLegacyAdminRecovery,
} from "./player-auth-policy";

describe("player password policy", () => {
    it("enforces length plus letter-and-number requirements", () => {
        assert.match(playerPasswordPolicyError("short1") ?? "", /at least 8/);
        assert.match(playerPasswordPolicyError("abcdefgh") ?? "", /letter and one number/);
        assert.match(playerPasswordPolicyError("12345678") ?? "", /letter and one number/);
        assert.equal(playerPasswordPolicyError("shinobi1"), null);
        assert.equal(playerPasswordPolicyError(`a1${"x".repeat(PLAYER_PASSWORD_MAX_LENGTH - 2)}`), null);
        assert.match(playerPasswordPolicyError(`a1${"x".repeat(PLAYER_PASSWORD_MAX_LENGTH - 1)}`) ?? "", /at most 128/);
    });
});

describe("legacy account recovery classification", () => {
    it("only treats an explicit 409 legacy response as admin recovery", () => {
        assert.equal(requiresLegacyAdminRecovery(409, { legacy: true, legacyNeedsAdmin: true }), true);
        assert.equal(requiresLegacyAdminRecovery(409, { legacyNeedsAdmin: true }), true);
        assert.equal(requiresLegacyAdminRecovery(200, { legacy: true }), false);
        assert.equal(requiresLegacyAdminRecovery(409, { ok: false }), false);
    });

    it("keeps login and local-dev auth wired to the fail-closed recovery path", () => {
        const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
        assert.match(appSource, /requiresLegacyAdminRecovery\(authRes\.status, authData\)/);
        assert.doesNotMatch(appSource, /if \(legacy && account/);

        const viteSource = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
        const changeStart = viteSource.indexOf("if (action === 'change')");
        const deleteStart = viteSource.indexOf("if (action === 'delete')", changeStart);
        assert.notEqual(changeStart, -1);
        assert.notEqual(deleteStart, -1);
        const changeHandler = viteSource.slice(changeStart, deleteStart);
        assert.match(changeHandler, /if \(!record\)/);
        assert.match(changeHandler, /sendJson\(res, 409/);
        assert.match(changeHandler, /sendJson\(res, 404/);
    });

    it("local-dev register and verify mirror the production token-first contract", () => {
        const viteSource = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
        assert.match(viteSource, /function issueDevSessionToken\(playerId: string\)/);
        const registerStart = viteSource.indexOf("if (action === 'register')");
        const verifyStart = viteSource.indexOf("if (action === 'verify')", registerStart);
        const changeStart = viteSource.indexOf("if (action === 'change')", verifyStart);
        assert.notEqual(registerStart, -1);
        assert.notEqual(verifyStart, -1);
        assert.notEqual(changeStart, -1);
        assert.match(viteSource.slice(registerStart, verifyStart), /token: issueDevSessionToken\(playerId\)/);
        assert.match(viteSource.slice(verifyStart, changeStart), /token: issueDevSessionToken\(playerId\)/);
    });

    it("never reports a rate limit or a missing token as a wrong password", () => {
        // Three faults compounded into permanent lockout: a 429 (the auth limiter is
        // IP-keyed, so one household shares it) and a token-less success both fell
        // through to the generic "Player name or password is incorrect" alert, and
        // there was no recovery route to point players at.
        const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

        // 429 must be classified before the generic verdict, and must NOT reuse the
        // credential-failure copy.
        assert.match(
            appSource,
            /if \(authRes\.status === 429\) \{ alert\(authRateLimitMessage\(authData\)\); return; \}/,
            "login must handle 429 explicitly instead of falling through to the password alert",
        );

        // The verdict must be the server's `ok` alone. issuePlayerToken returns null
        // when SESSION_SECRET is unset — the documented password fallback — so
        // requiring a token here rejects correct passwords.
        assert.match(
            appSource,
            /authOk = authData\.ok === true;/,
            "login must not require a session token to accept a verified password",
        );
        assert.doesNotMatch(
            appSource,
            /authOk = authData\.ok === true && typeof authData\.token === 'string'/,
            "the token requirement must stay out of the login verdict",
        );

        // A locked-out player needs somewhere to go: accounts carry no email, so a
        // reset can only happen through a moderator who verifies the character.
        const startSource = readFileSync(new URL("../screens/StartScreen.tsx", import.meta.url), "utf8");
        assert.match(startSource, /Forgotten your password\?/, "the login panel must surface a recovery route");
    });

    it("explains an auth rate limit as a shared-network wait, with a concrete time", () => {
        const withRetry = authRateLimitMessage({ retryAfterMs: 5 * 60_000 });
        assert.match(withRetry, /Too many sign-in attempts/);
        assert.match(withRetry, /about 5 minutes/);
        assert.match(withRetry, /Your password is fine\./);
        assert.doesNotMatch(withRetry, /incorrect/);

        // Sub-minute and zero waits must still round to a sane, non-zero instruction.
        assert.match(authRateLimitMessage({ retryAfterMs: 1 }), /about 1 minute\b/);
        assert.match(authRateLimitMessage({}), /wait a few minutes/);
        assert.match(authRateLimitMessage(null), /wait a few minutes/);
    });

    it("gives each auth action its own IP budget so logins survive group signups", () => {
        const authSource = readFileSync(new URL("../../../api/player-auth.ts", import.meta.url), "utf8");

        // Per-action buckets: a login must never be blocked by someone else's
        // registration attempts on the same connection.
        assert.match(authSource, /`player-auth:\$\{authAction\}`/, "the limiter bucket must include the action");
        assert.match(authSource, /verify: 40/, "login retries need headroom for typos across a shared IP");

        // Must stay IP-keyed: the name is unauthenticated here, so keying on it would
        // let an attacker mint a fresh budget per request.
        assert.match(
            authSource,
            /enforceRateLimitKv\(\s*req, res, `player-auth:\$\{authAction\}`, authBudget, 15 \* 60_000, undefined, \{ strict: true \},/,
            "auth must stay IP-keyed and strict (fail-open here means unlimited scrypt)",
        );
    });

    it("local-dev supports authenticated shared avatar publication", () => {
        const viteSource = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
        assert.match(viteSource, /server\.middlewares\.use\('\/api\/images'/);
        assert.match(viteSource, /const playerName = devTokenPlayer\(req\)/);
        assert.match(viteSource, /You can only set your own avatar/);
        assert.match(viteSource, /MAX_DEV_AVATAR_BYTES/);
        assert.match(viteSource, /await updateDevImages\(imagePath/);
    });
});

describe("display-name policy", () => {
    it("enforces a minimum and a maximum", () => {
        assert.match(playerNamePolicyError("ab") ?? "", /at least 3/);
        assert.equal(playerNamePolicyError("Rill"), null);
        assert.equal(playerNamePolicyError("x".repeat(PLAYER_NAME_MAX_LENGTH)), null);
        assert.match(playerNamePolicyError("x".repeat(PLAYER_NAME_MAX_LENGTH + 1)) ?? "", /at most 32/);
        assert.match(playerNamePolicyError(42) ?? "", /must be text/);
    });

    it("measures the trimmed name, so padding cannot smuggle length past the cap", () => {
        assert.equal(playerNamePolicyError(`  ${"x".repeat(PLAYER_NAME_MAX_LENGTH)}  `), null);
        assert.match(playerNamePolicyError(`  ab  `) ?? "", /at least 3/);
    });

    it("is bounded at every layer, not just the KV-key slug", () => {
        // The display name renders in OTHER players' leaderboards, nameplates, chat and
        // clan rosters. Only safeName's key truncation existed before, so an unbounded
        // name broke layout for everyone but its owner.
        const creator = readFileSync(new URL("../features/character-creator/CharacterCreatorFlow.tsx", import.meta.url), "utf8");
        assert.match(creator, /maxLength=\{PLAYER_NAME_MAX_LENGTH\}/, "the creator input needs a hard maxLength");

        const utils = readFileSync(new URL("../features/character-creator/characterCreatorUtils.ts", import.meta.url), "utf8");
        assert.match(utils, /playerNamePolicyError\(name\)/, "creator validation must use the shared policy");
        assert.doesNotMatch(utils, /name\.trim\(\)\.length < 3/, "the ad-hoc minimum must be gone");

        // Server: registration rejects with a message, the sanitizer truncates silently
        // as the backstop against a tampered client.
        const auth = readFileSync(new URL("../../../api/player-auth.ts", import.meta.url), "utf8");
        assert.match(auth, /name\.trim\(\)\.length > TEXT_LIMITS\.playerName/);
        const save = readFileSync(new URL("../../../api/save/[name].ts", import.meta.url), "utf8");
        assert.match(save, /char\.name = char\.name\.slice\(0, TEXT_LIMITS\.playerName\)/);
    });

    it("keeps the client ceiling equal to the server limit", () => {
        const moderation = readFileSync(new URL("../../../api/_text-moderation.ts", import.meta.url), "utf8");
        const serverLimit = Number(/playerName:\s*(\d+)/.exec(moderation)?.[1] ?? 0);
        assert.equal(
            PLAYER_NAME_MAX_LENGTH,
            serverLimit,
            "a client ceiling above the server's would let the creator submit a name the API rejects",
        );
    });
});
