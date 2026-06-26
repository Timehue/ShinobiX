"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _mercenaries_js_1 = require("./_mercenaries.js");
const VILLAGE_WAR_HP_MAX = 5000; // mirrors api/world-state.ts
(0, node_test_1.describe)("MERCENARY_TIERS catalog", () => {
    (0, node_test_1.it)("is the 5 owner-specified levels, in order", () => {
        node_assert_1.strict.deepEqual(_mercenaries_js_1.MERCENARY_TIERS.map(t => t.level), [75, 80, 85, 95, 100]);
    });
    (0, node_test_1.it)("has unique ids and positive cost/damage", () => {
        const ids = new Set();
        for (const t of _mercenaries_js_1.MERCENARY_TIERS) {
            node_assert_1.strict.ok(!ids.has(t.id), `dup id ${t.id}`);
            ids.add(t.id);
            node_assert_1.strict.ok(t.costSeals >= 1, `${t.id} cost`);
            node_assert_1.strict.ok(t.warDamage >= 1, `${t.id} damage`);
        }
    });
    (0, node_test_1.it)("cost and damage both climb with tier", () => {
        for (let i = 1; i < _mercenaries_js_1.MERCENARY_TIERS.length; i++) {
            node_assert_1.strict.ok(_mercenaries_js_1.MERCENARY_TIERS[i].costSeals > _mercenaries_js_1.MERCENARY_TIERS[i - 1].costSeals, "cost monotonic");
            node_assert_1.strict.ok(_mercenaries_js_1.MERCENARY_TIERS[i].warDamage > _mercenaries_js_1.MERCENARY_TIERS[i - 1].warDamage, "damage monotonic");
        }
    });
    (0, node_test_1.it)("no single merc — nor all of them — can end a war alone", () => {
        const total = _mercenaries_js_1.MERCENARY_TIERS.reduce((s, t) => s + t.warDamage, 0);
        for (const t of _mercenaries_js_1.MERCENARY_TIERS)
            node_assert_1.strict.ok(t.warDamage < VILLAGE_WAR_HP_MAX, `${t.id} < cap`);
        node_assert_1.strict.ok(total < VILLAGE_WAR_HP_MAX, "even all five can't drain a full war");
    });
});
(0, node_test_1.describe)("mercenaryById / isMercenaryTierId", () => {
    (0, node_test_1.it)("resolves known ids and rejects junk / proto pollution", () => {
        for (const t of _mercenaries_js_1.MERCENARY_TIERS)
            node_assert_1.strict.equal((0, _mercenaries_js_1.mercenaryById)(t.id)?.id, t.id);
        node_assert_1.strict.equal((0, _mercenaries_js_1.isMercenaryTierId)("merc-ronin"), true);
        node_assert_1.strict.equal((0, _mercenaries_js_1.isMercenaryTierId)("nope"), false);
        node_assert_1.strict.equal((0, _mercenaries_js_1.isMercenaryTierId)("__proto__"), false);
        node_assert_1.strict.equal((0, _mercenaries_js_1.mercenaryById)("__proto__"), null);
        node_assert_1.strict.equal((0, _mercenaries_js_1.mercenaryById)("toString"), null);
    });
});
(0, node_test_1.describe)("applyMercenaryDamage", () => {
    (0, node_test_1.it)("subtracts damage but floors enemy HP at 1 (never the killing blow)", () => {
        node_assert_1.strict.deepEqual((0, _mercenaries_js_1.applyMercenaryDamage)(5000, 750), { nextHp: 4250, dealt: 750 });
        node_assert_1.strict.deepEqual((0, _mercenaries_js_1.applyMercenaryDamage)(100, 750), { nextHp: 1, dealt: 99 });
        node_assert_1.strict.deepEqual((0, _mercenaries_js_1.applyMercenaryDamage)(1, 750), { nextHp: 1, dealt: 0 });
    });
    (0, node_test_1.it)("clamps junk input", () => {
        node_assert_1.strict.deepEqual((0, _mercenaries_js_1.applyMercenaryDamage)(NaN, 120), { nextHp: 1, dealt: 0 });
        node_assert_1.strict.deepEqual((0, _mercenaries_js_1.applyMercenaryDamage)(500, -50), { nextHp: 500, dealt: 0 });
    });
});
