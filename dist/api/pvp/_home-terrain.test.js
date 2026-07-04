"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Home-terrain buff parity (api/pvp/move.ts homeTerrainMultiplier).
 *
 * A captured sector grants the OWNING clan +10% to the leader-chosen offense
 * type. api/pvp/session.ts seals the matching jutsu TYPE onto the fighter as
 * `character.homeTerrainType` (owner-verified, server-side); move.ts applies
 * +10% to a matching-type jutsu. These pin the applier: matching type → ×1.1,
 * mismatched type → ×1.0, absent → ×1.0 — so the PvP engine agrees with the
 * client PvE territoryDamageMultiplier (shinobij.client/src/screens/Arena.tsx).
 */
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const move_js_1 = require("./move.js");
function fighter(name, homeTerrainType) {
    return {
        name, hp: 100000, maxHp: 100000, chakra: 1000, maxChakra: 1000,
        stamina: 1000, maxStamina: 1000, shield: 0, statuses: [], pos: 0,
        character: { name, stats: {}, jutsuMastery: [], ...(homeTerrainType ? { homeTerrainType } : {}) },
    };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asJutsu(j) {
    return { type: 'Taijutsu', range: 1, cooldown: 0, chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE', tags: [], ...j };
}
// Damage a single cast deals to a fresh 100k-HP dummy (big HP so no KO branch).
function dmg(self, jutsu) {
    const opp = fighter('Dummy');
    const r = (0, move_js_1.applyJutsu)(self, opp, asJutsu(jutsu), 1, 'central', 1);
    return 100000 - r.opponent.hp;
}
(0, node_test_1.describe)('PvP home-terrain buff', () => {
    const J = { id: 'tai-strike', name: 'Palm Strike', ap: 60, effectPower: 100 };
    (0, node_test_1.it)('a matching jutsu type on the clan-owned sector deals +10%', () => {
        const base = dmg(fighter('A'), J); // no homeTerrainType sealed
        const buffed = dmg(fighter('A', 'Taijutsu'), J); // Taijutsu terrain sealed
        node_assert_1.strict.ok(base > 0, `base damage should be > 0 (got ${base})`);
        node_assert_1.strict.ok(buffed > base, `buffed (${buffed}) should exceed base (${base})`);
        node_assert_1.strict.ok(Math.abs(buffed / base - 1.1) < 0.02, `expected ~1.1x, got ${(buffed / base).toFixed(3)}x`);
    });
    (0, node_test_1.it)('a non-matching jutsu type gets no home-terrain bonus', () => {
        const base = dmg(fighter('A'), { ...J, type: 'Ninjutsu' });
        const withBuff = dmg(fighter('A', 'Taijutsu'), { ...J, type: 'Ninjutsu' });
        node_assert_1.strict.equal(withBuff, base, 'a Ninjutsu cast must not benefit from a Taijutsu terrain buff');
    });
    (0, node_test_1.it)('no sealed homeTerrainType leaves damage unchanged (default sessions unaffected)', () => {
        node_assert_1.strict.equal(dmg(fighter('A'), J), dmg(fighter('B'), J), 'two unbuffed fighters deal identical base damage');
    });
});
