"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Town Defense guard mitigation regression guard (api/pvp/move.ts).
 *
 * The "Town Defense" village upgrade is meant to reduce the damage a Village
 * Guard takes while defending. The AI-fallback path already folds it into the
 * chosen AI's effective level client-side, but a REAL-player guard duel used to
 * drop it entirely. api/pvp/session.ts now seals the server-recomputed bonus
 * onto the defender's character.guardDefensePct (≤5%), and resolveDamageNumber
 * applies it as a flat % reduction to direct jutsu damage.
 *
 * These tests pin that behaviour at the move-resolution layer:
 *   • a sealed guardDefensePct reduces direct damage by exactly that %,
 *   • absent / zero bonus is a no-op,
 *   • Pierce true damage bypasses the mitigation (like every other DR source).
 */
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const move_js_1 = require("./move.js");
function fighter(name, guardDefensePct) {
    return {
        name,
        hp: 1000,
        maxHp: 1000,
        chakra: 1000,
        maxChakra: 1000,
        stamina: 1000,
        maxStamina: 1000,
        shield: 0,
        statuses: [],
        pos: 0,
        character: {
            name,
            stats: {},
            jutsuMastery: [],
            ...(guardDefensePct != null ? { guardDefensePct } : {}),
        },
    };
}
// Minimal damaging jutsu — ap 60 so it isn't a zero-damage utility cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dmgJutsu(tags = [], id = 'dmg') {
    return {
        id, name: id, type: 'Ninjutsu', element: 'Fire',
        ap: 60, range: 1, effectPower: 30, cooldown: 0,
        chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE', tags,
    };
}
function dealtTo(opponent, attacker, jutsu) {
    const r = (0, move_js_1.applyJutsu)(attacker, opponent, jutsu, 1, 'central', 1);
    return opponent.maxHp - r.opponent.hp;
}
(0, node_test_1.describe)('PvP Town Defense guard mitigation', () => {
    (0, node_test_1.it)('reduces direct jutsu damage to a guard by their sealed guardDefensePct', () => {
        const attacker = fighter('Raider');
        const base = dealtTo(fighter('Guard'), attacker, dmgJutsu());
        node_assert_1.strict.ok(base > 0, 'baseline jutsu should deal damage');
        const guarded = dealtTo(fighter('Guard', 5), attacker, dmgJutsu());
        node_assert_1.strict.equal(guarded, Math.floor(base * 0.95), '5% Town Defense shaves 5% off direct damage');
        node_assert_1.strict.ok(guarded < base, 'a guard with the bonus takes strictly less damage');
    });
    (0, node_test_1.it)('is a no-op when the defender has no (or zero) guardDefensePct', () => {
        const attacker = fighter('Raider');
        const absent = dealtTo(fighter('B'), attacker, dmgJutsu());
        const zero = dealtTo(fighter('B', 0), attacker, dmgJutsu());
        node_assert_1.strict.equal(absent, zero, 'absent and 0% must deal identical damage');
    });
    (0, node_test_1.it)('Pierce true damage bypasses the guard mitigation', () => {
        const attacker = fighter('Raider');
        const noGuard = dealtTo(fighter('G1'), attacker, dmgJutsu([{ name: 'Pierce' }], 'pierce'));
        const withGuard = dealtTo(fighter('G2', 5), attacker, dmgJutsu([{ name: 'Pierce' }], 'pierce'));
        node_assert_1.strict.equal(noGuard, withGuard, 'Pierce ignores guard mitigation');
    });
});
