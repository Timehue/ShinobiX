import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { characterWithVillageTax, readVillageTaxEcho, villageTaxNotice } from "./village-tax-echo";

// The occupation-tax echo the daily routes return (2026-10 rebalance, I-11).

describe("village tax echo", () => {
    it("reads the echo and its stamped save version", () => {
        const echo = readVillageTaxEcho({ villageTax: { applied: true, taxed: 4_950, toBurn: 2_475, toTreasury: 2_475, ryo: 495_050, bankRyo: 0, _saveVersion: 7 } });
        assert.deepEqual(echo, { applied: true, taxed: 4_950, toBurn: 2_475, toTreasury: 2_475, ryo: 495_050, bankRyo: 0, _saveVersion: 7 });
        assert.equal(readVillageTaxEcho({ ok: true }), null);
        assert.equal(readVillageTaxEcho(null), null);
        assert.equal(readVillageTaxEcho({ villageTax: { applied: false, _saveVersion: "junk" } })?._saveVersion, undefined);
    });

    it("adopts the post-tax balances only when ryo was debited", () => {
        const character = { ryo: 500_000, bankRyo: 10, name: "x" };
        const taxed = readVillageTaxEcho({ villageTax: { applied: true, taxed: 4_950, ryo: 495_050, bankRyo: 10 } })!;
        assert.deepEqual(characterWithVillageTax(character, taxed), { ryo: 495_050, bankRyo: 10, name: "x" });
        const stamped = readVillageTaxEcho({ villageTax: { applied: false, taxed: 0, ryo: 0, bankRyo: 0, _saveVersion: 3 } })!;
        assert.equal(characterWithVillageTax(character, stamped), character, "an untaxed day changes no balance");
    });

    it("tells the player what was taxed, and stays quiet otherwise", () => {
        assert.match(String(villageTaxNotice(readVillageTaxEcho({ villageTax: { applied: true, taxed: 4_950 } }))), /Occupation tax: −4,950 ryo/);
        assert.equal(villageTaxNotice(readVillageTaxEcho({ villageTax: { applied: false } })), null);
        assert.equal(villageTaxNotice(null), null);
    });
});
