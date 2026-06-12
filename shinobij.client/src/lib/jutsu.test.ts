/*
 * normalizeJutsu guard — the client load boundary that strips the legacy EP-100
 * "fixed effect" sentinel. A jutsu carrying a binary control / displacement tag
 * deals STANDARD 60-AP damage (40), not ~3200, so preview + PvE combat agree
 * with the server (which clamps the same way in sanitizeJutsuList). Mirrors
 * api/pvp/_tags.ts.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { normalizeJutsu } from "./jutsu";

const make = (effectPower: number, tagName: string, ap = 60) =>
    normalizeJutsu({ id: "j", name: "J", type: "Ninjutsu", ap, effectPower, tags: [{ name: tagName, percent: 0 }] });

describe("normalizeJutsu — fixed-effect EP-100 sentinel is clamped to standard 40", () => {
    it("clamps a 60-AP control jutsu from EP 100 to 40", () => {
        assert.equal(make(100, "Stun").effectPower, 40);
        assert.equal(make(100, "Copy").effectPower, 40);
        assert.equal(make(100, "Push").effectPower, 40);
    });

    it("is alias-aware (Seal → Bloodline Seal is a fixed-effect tag)", () => {
        assert.equal(make(100, "Seal").effectPower, 40);
    });

    it("never raises EP — only clamps the sentinel down", () => {
        assert.equal(make(40, "Stun").effectPower, 40);
        assert.equal(make(30, "Stun").effectPower, 30);
    });

    it("leaves a normal damage jutsu untouched", () => {
        assert.equal(make(50, "Wound").effectPower, 50);
        assert.equal(normalizeJutsu({ id: "n", name: "N", type: "Ninjutsu", ap: 60, effectPower: 36, tags: [] }).effectPower, 36);
    });
});
