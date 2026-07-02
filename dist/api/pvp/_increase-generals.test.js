"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Regression guard for the Increase Generals tag (api/pvp/move.ts).
 *
 * Increase Generals is the first status that modifies raw stats mid-combat: it
 * lifts str/spd/int/wil, which feed BOTH the offense and defense composites
 * (getOffense/getDefense), so a self-cast raises damage dealt AND lowers damage
 * taken through statFactor. The lift is:
 *   • folded in ABOVE the per-rank stat cap (generalsBonus at applyJutsu), so it
 *     still matters when both fighters are stat-capped at endgame;
 *   • soft-capped through the K_GENERALS pool so stacking can't drive statFactor
 *     to the [0.35, 1.85] clamp;
 *   • suppressed entirely while the fighter is Bloodline-Sealed.
 *
 * These pin the behaviour the balance sim was tuned around.
 */
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const move_js_1 = require("./move.js");
function fighter(name, statuses = []) {
    return {
        name,
        hp: 1000,
        maxHp: 1000,
        chakra: 1000,
        maxChakra: 1000,
        stamina: 1000,
        maxStamina: 1000,
        shield: 0,
        statuses,
        pos: 0,
        character: { name, stats: {}, jutsuMastery: [] },
    };
}
// A plain 60-AP damage jutsu (no tags) — the vehicle for measuring how much
// damage an active Increase Generals status shifts.
function dmgJutsu(tags = []) {
    return {
        id: 'dmg', name: 'dmg', type: 'Ninjutsu', element: 'Fire',
        ap: 60, range: 1, effectPower: 30, cooldown: 0,
        chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE', tags,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    };
}
// Active (non-deferred) Increase Generals status at a given percent.
function ig(percent) {
    return { name: 'Increase Generals', percent, rounds: 2, kind: 'positive' };
}
// Damage a cast deals to the opponent (hp lost).
function dealt(self, opp) {
    const r = (0, move_js_1.applyJutsu)(self, opp, dmgJutsu(), 1, 'central', 1);
    return opp.hp - r.opponent.hp;
}
(0, node_test_1.describe)('Increase Generals — combat effect', () => {
    (0, node_test_1.it)('raises the caster\'s damage dealt (offense side)', () => {
        const base = dealt(fighter('A'), fighter('B'));
        const buffed = dealt(fighter('A', [ig(30)]), fighter('B'));
        node_assert_1.strict.ok(buffed > base, `buffed attack (${buffed}) should exceed baseline (${base})`);
    });
    (0, node_test_1.it)('lowers the damage the buffed fighter takes (defense side)', () => {
        const base = dealt(fighter('A'), fighter('B'));
        const vsBuffedDefender = dealt(fighter('A'), fighter('B', [ig(30)]));
        node_assert_1.strict.ok(vsBuffedDefender < base, `hit on a Generals-buffed defender (${vsBuffedDefender}) should be below baseline (${base})`);
    });
    (0, node_test_1.it)('is suppressed while the buffed fighter is Bloodline-Sealed', () => {
        const base = dealt(fighter('A'), fighter('B'));
        const sealed = dealt(fighter('A', [ig(30), { name: 'Bloodline Seal', rounds: 2, kind: 'negative' }]), fighter('B'));
        node_assert_1.strict.equal(sealed, base, 'a sealed fighter gets no Increase Generals lift');
    });
    (0, node_test_1.it)('stacks with diminishing returns (2 stacks < 2× a single stack over baseline)', () => {
        const base = dealt(fighter('A'), fighter('B'));
        const one = dealt(fighter('A', [ig(30)]), fighter('B')) - base;
        const two = dealt(fighter('A', [ig(30), ig(30)]), fighter('B')) - base;
        node_assert_1.strict.ok(two > one, 'two stacks should out-hit one');
        node_assert_1.strict.ok(two < one * 2, `two stacks (${two}) must be sub-linear vs one (${one}) — the K_GENERALS pool`);
    });
    (0, node_test_1.it)('casting the tag applies a deferred 2-round positive status, Buff-Prevent-gated', () => {
        const cast = (0, move_js_1.applyJutsu)(fighter('A'), fighter('B'), dmgJutsu([{ name: 'Increase Generals', percent: 30 }]), 1, 'central', 1);
        const st = cast.self.statuses.find((s) => s.name === 'Increase Generals');
        node_assert_1.strict.ok(st, 'an Increase Generals status should be queued on the caster');
        node_assert_1.strict.equal(st?.rounds, 2, 'lasts 2 rounds');
        node_assert_1.strict.equal(st?.activeRound, 2, 'deferred to next round (does not boost its own cast)');
        // Buff Prevent on the caster blocks the application.
        const prevented = (0, move_js_1.applyJutsu)(fighter('A', [{ name: 'Buff Prevent', rounds: 2, kind: 'negative' }]), fighter('B'), dmgJutsu([{ name: 'Increase Generals', percent: 30 }]), 1, 'central', 1);
        node_assert_1.strict.ok(!prevented.self.statuses.some((s) => s.name === 'Increase Generals'), 'Buff Prevent blocks the buff');
    });
});
