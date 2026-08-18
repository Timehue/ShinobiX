import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    RECOVERY_CODE_LENGTH,
    formatRecoveryCode,
    formatRecoveryCodeInput,
    looksLikeRecoveryCode,
    normalizeRecoveryCode,
} from "./recovery-code";

describe("recovery code shape (client mirror)", () => {
    it("normalizes what a player types off paper", () => {
        assert.equal(normalizeRecoveryCode("k4m2x-8tq9b-3nzpr-7wgvh"), "K4M2X8TQ9B3NZPR7WGVH");
        assert.equal(normalizeRecoveryCode("K4M2X8TQ9B3NZPR7WGVH"), "K4M2X8TQ9B3NZPR7WGVH");
        assert.equal(normalizeRecoveryCode("K4M2X 8TQ9B 3NZPR 7WGVH"), "K4M2X8TQ9B3NZPR7WGVH");
        assert.equal(normalizeRecoveryCode("  K4M2X-8TQ9B-3NZPR-7WGVH  "), "K4M2X8TQ9B3NZPR7WGVH");
    });

    it("folds the letters people confuse for digits", () => {
        assert.equal(normalizeRecoveryCode("OOOOO-11111-22222-33333"), "00000111112222233333");
        assert.equal(normalizeRecoveryCode("IIIII-LLLLL-22222-33333"), "11111111112222233333");
        assert.equal(normalizeRecoveryCode("UUUUU-11111-22222-33333"), "VVVVV111112222233333");
    });

    it("rejects anything of the wrong length or alphabet", () => {
        for (const bad of ["", "nope", null, undefined, 7, "ABCDE-ABCDE-ABCDE", "ABCD!-ABCDE-ABCDE-ABCDE"]) {
            assert.equal(normalizeRecoveryCode(bad as unknown), "");
            assert.equal(looksLikeRecoveryCode(bad as unknown), false);
        }
        assert.equal(looksLikeRecoveryCode("K4M2X-8TQ9B-3NZPR-7WGVH"), true);
    });

    it("regroups for display", () => {
        assert.equal(formatRecoveryCode("K4M2X8TQ9B3NZPR7WGVH"), "K4M2X-8TQ9B-3NZPR-7WGVH");
    });

    it("formats as you type without eating an incomplete value", () => {
        assert.equal(formatRecoveryCodeInput("k4m2x8"), "K4M2X-8");
        assert.equal(formatRecoveryCodeInput("K4M2X-8TQ9B-3NZPR-7WGVH"), "K4M2X-8TQ9B-3NZPR-7WGVH");
        // Pasting more than a code is worth is truncated, not rejected.
        assert.equal(formatRecoveryCodeInput("K4M2X8TQ9B3NZPR7WGVHEXTRA"), "K4M2X-8TQ9B-3NZPR-7WGVH");
        assert.equal(formatRecoveryCodeInput(""), "");
    });
});

describe("recovery code parity with the server", () => {
    const serverSource = readFileSync(new URL("../../../api/_recovery-code.ts", import.meta.url), "utf8");

    it("uses the same alphabet the server samples from", () => {
        // A divergence here silently turns valid codes into "that is not a
        // code" before the request is ever sent, which looks to the player like
        // the code was wrong.
        assert.ok(
            serverSource.includes("const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'"),
            "server alphabet changed — update shinobij.client/src/lib/recovery-code.ts to match",
        );
    });

    it("uses the same length", () => {
        assert.equal(RECOVERY_CODE_LENGTH, 20);
        assert.match(serverSource, /const GROUP_SIZE = 5;/);
        assert.match(serverSource, /const GROUP_COUNT = 4;/);
    });

    it("folds the ambiguous letters the same way", () => {
        for (const fold of [
            /\.replace\(\/O\/g, '0'\)/,
            /\.replace\(\/\[IL\]\/g, '1'\)/,
            /\.replace\(\/U\/g, 'V'\)/,
        ]) {
            assert.match(serverSource, fold, "server normalization changed — mirror it on the client");
        }
    });
});
