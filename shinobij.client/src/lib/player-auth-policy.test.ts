import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
    PLAYER_PASSWORD_MAX_LENGTH,
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

    it("local-dev supports authenticated shared avatar publication", () => {
        const viteSource = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
        assert.match(viteSource, /server\.middlewares\.use\('\/api\/images'/);
        assert.match(viteSource, /const playerName = devTokenPlayer\(req\)/);
        assert.match(viteSource, /You can only set your own avatar/);
        assert.match(viteSource, /MAX_DEV_AVATAR_BYTES/);
        assert.match(viteSource, /await updateDevImages\(imagePath/);
    });
});
