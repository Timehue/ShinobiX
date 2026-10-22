import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pvpCreditNote } from "./pvp-credit-copy";
import type { PvpRewardCredit } from "./progression";

const full: PvpRewardCredit = { credited: true, kind: "ko", short: false, pairOrdinal: 1, pairWeight: 1, sideMult: 1 };

describe("pvpCreditNote", () => {
    it("says nothing for a full-credit fight", () => {
        assert.equal(pvpCreditNote(full, "win"), null);
        assert.equal(pvpCreditNote(undefined, "win"), null);
    });
    it("explains repeat-opponent, short-fight and flee reductions", () => {
        assert.equal(pvpCreditNote({ ...full, pairOrdinal: 3, pairWeight: 0.5 }, "win"), "Fight 3 with this opponent today: 50% pay.");
        assert.match(pvpCreditNote({ ...full, pairOrdinal: 5, pairWeight: 0 }, "win") ?? "", /no further pay until tomorrow/);
        assert.equal(pvpCreditNote({ ...full, short: true, sideMult: 0.5 }, "win"), "Short fight (under 3 rounds or 60 seconds): 50% pay.");
        assert.match(pvpCreditNote({ ...full, kind: "flee", short: true, sideMult: 0 }, "win") ?? "", /fled or idled/);
    });
    it("explains uncredited fights and the loss-pay floor", () => {
        assert.match(pvpCreditNote({ ...full, credited: false, reason: "level-gap", pairWeight: 0 }, "win") ?? "", /20 levels/);
        assert.match(pvpCreditNote({ ...full, credited: false, reason: "too-young", pairWeight: 0 }, "loss") ?? "", /72 hours/);
        assert.match(pvpCreditNote({ ...full, sideMult: 0 }, "loss") ?? "", /15% of the winner's HP/);
        // An engaged loser whose winner is not established is told the real reason.
        const blocked = pvpCreditNote({ ...full, sideMult: 0, lossBlocked: "too-young" }, "loss") ?? "";
        assert.match(blocked, /winner's account is under 72 hours old and below level 20/);
        assert.doesNotMatch(blocked, /15% of the winner's HP/);
    });
    it("words the live thresholds the server sends, not hard-coded defaults", () => {
        const rules = { minRounds: 2, minFightSeconds: 30, lossMinDamagePct: 10, minAccountAgeHours: 48, establishedLevel: 20, levelGapMax: 15 };
        assert.equal(pvpCreditNote({ ...full, short: true, sideMult: 0.5, rules }, "win"), "Short fight (under 2 rounds or 30 seconds): 50% pay.");
        assert.match(pvpCreditNote({ ...full, sideMult: 0, rules }, "loss") ?? "", /2 rounds and 30 seconds, and 10% of the winner's HP/);
        assert.match(pvpCreditNote({ ...full, credited: false, reason: "too-young", pairWeight: 0, rules }, "loss") ?? "", /under 48 hours old and below level 20/);
        assert.match(pvpCreditNote({ ...full, credited: false, reason: "level-gap", pairWeight: 0, rules }, "win") ?? "", /more than 15 levels/);
    });
});
