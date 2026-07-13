"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Regression guard: PvP weapon attacks must deal damage (api/pvp/move.ts).
 *
 * The bug: hand weapons omit `apCost`, so the weapon synth got `ap: 40` (the
 * default). With no `isUtility` flag, that tripped the legacy 40-AP "zero-damage
 * utility" rule (isZeroDamageFortyApJutsu) and the weapon dealt ZERO base damage
 * in PvP — while PvE was exempt (its synth uses an 'item-' id). The fix sets
 * `isUtility: false` on the weapon synth. These tests pin BOTH directions:
 *   • a weapon (isUtility:false, ap:40) deals weaponEp-scaled damage, and
 *   • a genuine 40-AP utility jutsu (isUtility undefined, non-exempt id) still
 *     deals zero damage — so the fix didn't disable the utility rule itself.
 */
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const move_js_1 = require("./move.js");
function fighter(name, hp = 1000) {
    return {
        name,
        hp,
        maxHp: 1000,
        chakra: 1000,
        maxChakra: 1000,
        stamina: 1000,
        maxStamina: 1000,
        shield: 0,
        statuses: [],
        pos: 0,
        character: { name, stats: {}, jutsuMastery: [] },
    };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asJutsu(j) {
    return { type: 'Bukijutsu', range: 1, cooldown: 0, chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE', tags: [], ...j };
}
(0, node_test_1.describe)('PvP weapon damage', () => {
    (0, node_test_1.it)('a 40-AP weapon (isUtility:false) deals weaponEp-scaled damage', () => {
        const self = fighter('A');
        const opp = fighter('B');
        // Mirrors the weapon synth in move.ts: id 'weapon', ap 40, isUtility false.
        const r = (0, move_js_1.applyJutsu)(self, opp, asJutsu({ id: 'weapon', name: 'Katana', isUtility: false, ap: 40, effectPower: 18 }), 1, 'central', 1);
        node_assert_1.strict.ok(r.opponent.hp < 1000, `weapon should deal damage, opponent hp=${r.opponent.hp}`);
    });
    (0, node_test_1.it)('a genuine 40-AP utility jutsu still deals ZERO base damage (rule intact)', () => {
        const self = fighter('A');
        const opp = fighter('B');
        const r = (0, move_js_1.applyJutsu)(self, opp, asJutsu({ id: 'buff-x', name: 'Utility', ap: 40, effectPower: 18 }), 1, 'central', 1);
        node_assert_1.strict.equal(r.opponent.hp, 1000, 'a 40-AP non-exempt jutsu with no isUtility flag must deal 0 base damage');
    });
    (0, node_test_1.it)('the basic attack (id basic-attack, ap 40) still deals damage', () => {
        const self = fighter('A');
        const opp = fighter('B');
        const r = (0, move_js_1.applyJutsu)(self, opp, asJutsu({ id: 'basic-attack', name: 'Basic Attack', ap: 40, effectPower: 10 }), 1, 'central', 1);
        node_assert_1.strict.ok(r.opponent.hp < 1000, `basic attack should deal damage, opponent hp=${r.opponent.hp}`);
    });
    (0, node_test_1.it)('a weapon carrying an Increase Generals tag applies the self-buff (named-weapon roll path)', () => {
        const self = fighter('A');
        const opp = fighter('B');
        // Named weapons carry weaponTags → move.ts builds a weaponJutsu with those tags
        // (id 'weapon', isUtility:false) → applyJutsu resolves them. Prove the rolled
        // Increase Generals tag lands as a buff on the wielder AND the weapon still hits.
        const r = (0, move_js_1.applyJutsu)(self, opp, asJutsu({ id: 'weapon', name: 'Named Blade', isUtility: false, ap: 40, effectPower: 18, tags: [{ name: 'Increase Generals', percent: 35 }] }), 1, 'central', 1);
        const st = r.self.statuses.find(s => s.name === 'Increase Generals');
        node_assert_1.strict.ok(st, "the weapon's Increase Generals tag should apply a status to the wielder");
        node_assert_1.strict.equal(st?.rounds, 2, 'buff lasts 2 rounds');
        node_assert_1.strict.ok(r.opponent.hp < 1000, 'the weapon still deals its damage');
    });
});
(0, node_test_1.describe)('weapon → bloodline multiplier gate (suppressBloodline)', () => {
    // A wielder whose bloodline multiplies damage ×1.5 and who has awakened Fire.
    function blFighter() {
        const f = fighter('BL');
        f.character = { name: 'BL', stats: {}, jutsuMastery: [], bloodlineMult: 1.5, elements: ['Fire'] };
        return f;
    }
    (0, node_test_1.it)('a weapon swing WITHOUT suppressBloodline rides the bloodline mult; WITH it does not', () => {
        const oppBoost = fighter('D1');
        const oppGated = fighter('D2');
        const boosted = (0, move_js_1.applyJutsu)(blFighter(), oppBoost, asJutsu({ id: 'weapon', name: 'Blade', isUtility: false, ap: 40, effectPower: 30 }), 1, 'central', 1);
        const gated = (0, move_js_1.applyJutsu)(blFighter(), oppGated, asJutsu({ id: 'weapon', name: 'Blade', isUtility: false, ap: 40, effectPower: 30, suppressBloodline: true }), 1, 'central', 1);
        node_assert_1.strict.ok(boosted.opponent.hp < 1000, 'the bloodline-boosted weapon deals damage');
        node_assert_1.strict.ok(gated.opponent.hp < 1000, 'the gated weapon still deals its (unboosted) damage');
        node_assert_1.strict.ok(gated.opponent.hp > boosted.opponent.hp, `suppressBloodline must strip the bloodline mult (boosted hp=${boosted.opponent.hp}, gated hp=${gated.opponent.hp})`);
    });
});
(0, node_test_1.describe)('characterOwnsElement (weapon element ownership)', () => {
    (0, node_test_1.it)('matches an awakened element case-insensitively, from elements[] or element', () => {
        node_assert_1.strict.equal((0, move_js_1.characterOwnsElement)({ elements: ['Fire', 'Water'] }, 'fire'), true);
        node_assert_1.strict.equal((0, move_js_1.characterOwnsElement)({ element: 'Lightning' }, 'Lightning'), true);
        node_assert_1.strict.equal((0, move_js_1.characterOwnsElement)({ elements: ['Wind'] }, 'Earth'), false);
    });
    (0, node_test_1.it)('an empty / missing / "None" weapon element never qualifies (no-element weapon → no boost)', () => {
        node_assert_1.strict.equal((0, move_js_1.characterOwnsElement)({ elements: ['Fire'] }, ''), false);
        node_assert_1.strict.equal((0, move_js_1.characterOwnsElement)({ elements: ['Fire'] }, undefined), false);
        node_assert_1.strict.equal((0, move_js_1.characterOwnsElement)({ elements: ['Fire'] }, 'None'), false);
    });
    (0, node_test_1.it)('a character with no elements owns nothing', () => {
        node_assert_1.strict.equal((0, move_js_1.characterOwnsElement)({}, 'Fire'), false);
        node_assert_1.strict.equal((0, move_js_1.characterOwnsElement)(null, 'Fire'), false);
    });
});
