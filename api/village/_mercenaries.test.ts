import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    MERCENARY_TIERS,
    mercenaryById,
    isMercenaryTierId,
    applyMercenaryDamage,
} from "./_mercenaries.js";

const VILLAGE_WAR_HP_MAX = 5000; // mirrors api/world-state.ts

describe("MERCENARY_TIERS catalog", () => {
    it("is the 5 owner-specified levels, in order", () => {
        assert.deepEqual(MERCENARY_TIERS.map(t => t.level), [75, 80, 85, 95, 100]);
    });
    it("has unique ids and positive cost/damage", () => {
        const ids = new Set<string>();
        for (const t of MERCENARY_TIERS) {
            assert.ok(!ids.has(t.id), `dup id ${t.id}`);
            ids.add(t.id);
            assert.ok(t.costSeals >= 1, `${t.id} cost`);
            assert.ok(t.warDamage >= 1, `${t.id} damage`);
        }
    });
    it("cost and damage both climb with tier", () => {
        for (let i = 1; i < MERCENARY_TIERS.length; i++) {
            assert.ok(MERCENARY_TIERS[i].costSeals > MERCENARY_TIERS[i - 1].costSeals, "cost monotonic");
            assert.ok(MERCENARY_TIERS[i].warDamage > MERCENARY_TIERS[i - 1].warDamage, "damage monotonic");
        }
    });
    it("no single merc — nor all of them — can end a war alone", () => {
        const total = MERCENARY_TIERS.reduce((s, t) => s + t.warDamage, 0);
        for (const t of MERCENARY_TIERS) assert.ok(t.warDamage < VILLAGE_WAR_HP_MAX, `${t.id} < cap`);
        assert.ok(total < VILLAGE_WAR_HP_MAX, "even all five can't drain a full war");
    });
});

describe("mercenaryById / isMercenaryTierId", () => {
    it("resolves known ids and rejects junk / proto pollution", () => {
        for (const t of MERCENARY_TIERS) assert.equal(mercenaryById(t.id)?.id, t.id);
        assert.equal(isMercenaryTierId("merc-ronin"), true);
        assert.equal(isMercenaryTierId("nope"), false);
        assert.equal(isMercenaryTierId("__proto__"), false);
        assert.equal(mercenaryById("__proto__"), null);
        assert.equal(mercenaryById("toString"), null);
    });
});

describe("applyMercenaryDamage", () => {
    it("subtracts damage but floors enemy HP at 1 (never the killing blow)", () => {
        assert.deepEqual(applyMercenaryDamage(5000, 750), { nextHp: 4250, dealt: 750 });
        assert.deepEqual(applyMercenaryDamage(100, 750), { nextHp: 1, dealt: 99 });
        assert.deepEqual(applyMercenaryDamage(1, 750), { nextHp: 1, dealt: 0 });
    });
    it("clamps junk input", () => {
        assert.deepEqual(applyMercenaryDamage(NaN, 120), { nextHp: 1, dealt: 0 });
        assert.deepEqual(applyMercenaryDamage(500, -50), { nextHp: 500, dealt: 0 });
    });
});
