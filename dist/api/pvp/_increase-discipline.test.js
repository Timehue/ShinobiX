"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Regression guard for the Increase Discipline tag (api/pvp/move.ts) — the
 * style-locked sibling of Increase Generals, carried by legacy signature jutsu.
 *
 * The contract these pin:
 *   • the lift applies ONLY to casts whose type matches the stack's captured
 *     discipline — a Taijutsu stack does nothing for a Ninjutsu cast;
 *   • it is offense-only — a buffed DEFENDER takes exactly baseline damage;
 *   • the discipline is captured server-side from the CAST jutsu's type
 *     (never client-supplied), and an 'Any'/unknown-typed cast is a no-op;
 *   • pooled through K_DISCIPLINE (diminishing returns), suppressed by
 *     Bloodline Seal, Buff-Prevent-gated — all matching Increase Generals.
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
// A plain 60-AP damage jutsu of a given discipline — the vehicle for measuring
// how much damage an active Increase Discipline stack shifts.
function dmgJutsu(type, tags = []) {
    return {
        id: 'dmg', name: 'dmg', type, element: 'Fire',
        ap: 60, range: 1, effectPower: 30, cooldown: 0,
        chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE', tags,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    };
}
// Active (non-deferred) Increase Discipline stack locked to a discipline.
function idStack(discipline, percent) {
    return { name: 'Increase Discipline', percent, rounds: 2, kind: 'positive', discipline };
}
// Damage a cast of `type` deals to the opponent (hp lost).
function dealt(self, opp, type = 'Ninjutsu') {
    const r = (0, move_js_1.applyJutsu)(self, opp, dmgJutsu(type), 1, 'central', 1);
    return opp.hp - r.opponent.hp;
}
(0, node_test_1.describe)('Increase Discipline — style-locked combat effect', () => {
    (0, node_test_1.it)('raises damage for casts of the MATCHING discipline', () => {
        const base = dealt(fighter('A'), fighter('B'), 'Ninjutsu');
        const buffed = dealt(fighter('A', [idStack('Ninjutsu', 35)]), fighter('B'), 'Ninjutsu');
        node_assert_1.strict.ok(buffed > base, `matching-discipline cast (${buffed}) should exceed baseline (${base})`);
    });
    (0, node_test_1.it)('does NOTHING for casts of a different discipline (the style lock)', () => {
        const base = dealt(fighter('A'), fighter('B'), 'Ninjutsu');
        const crossStyle = dealt(fighter('A', [idStack('Taijutsu', 35)]), fighter('B'), 'Ninjutsu');
        node_assert_1.strict.equal(crossStyle, base, 'a Taijutsu stack must not lift a Ninjutsu cast');
    });
    (0, node_test_1.it)('is offense-only — a buffed DEFENDER takes baseline damage (no defense side)', () => {
        const base = dealt(fighter('A'), fighter('B'), 'Ninjutsu');
        const vsBuffedDefender = dealt(fighter('A'), fighter('B', [idStack('Ninjutsu', 35)]), 'Ninjutsu');
        node_assert_1.strict.equal(vsBuffedDefender, base, 'Increase Discipline must not reduce incoming damage');
    });
    (0, node_test_1.it)('is suppressed while the buffed fighter is Bloodline-Sealed', () => {
        const base = dealt(fighter('A'), fighter('B'), 'Taijutsu');
        const sealed = dealt(fighter('A', [idStack('Taijutsu', 35), { name: 'Bloodline Seal', rounds: 2, kind: 'negative' }]), fighter('B'), 'Taijutsu');
        node_assert_1.strict.equal(sealed, base, 'a sealed fighter gets no Increase Discipline lift');
    });
    (0, node_test_1.it)('stacks with diminishing returns (2 stacks < 2× a single stack over baseline)', () => {
        const base = dealt(fighter('A'), fighter('B'), 'Genjutsu');
        const one = dealt(fighter('A', [idStack('Genjutsu', 30)]), fighter('B'), 'Genjutsu') - base;
        const two = dealt(fighter('A', [idStack('Genjutsu', 30), idStack('Genjutsu', 30)]), fighter('B'), 'Genjutsu') - base;
        node_assert_1.strict.ok(two > one, 'two stacks should out-hit one');
        node_assert_1.strict.ok(two < one * 2, `two stacks (${two}) must be sub-linear vs one (${one}) — the K_DISCIPLINE pool`);
    });
    (0, node_test_1.it)('casting the tag captures the jutsu type as the stack discipline, deferred + Buff-Prevent-gated', () => {
        const cast = (0, move_js_1.applyJutsu)(fighter('A'), fighter('B'), dmgJutsu('Bukijutsu', [{ name: 'Increase Discipline', percent: 35 }]), 1, 'central', 1);
        const st = cast.self.statuses.find((s) => s.name === 'Increase Discipline');
        node_assert_1.strict.ok(st, 'an Increase Discipline status should be queued on the caster');
        node_assert_1.strict.equal(st?.discipline, 'Bukijutsu', 'the stack locks to the CAST jutsu type, server-captured');
        node_assert_1.strict.equal(st?.rounds, 2, 'lasts 2 rounds');
        node_assert_1.strict.equal(st?.activeRound, 2, 'deferred to next round (does not boost its own cast)');
        const prevented = (0, move_js_1.applyJutsu)(fighter('A', [{ name: 'Buff Prevent', rounds: 2, kind: 'negative' }]), fighter('B'), dmgJutsu('Bukijutsu', [{ name: 'Increase Discipline', percent: 35 }]), 1, 'central', 1);
        node_assert_1.strict.ok(!prevented.self.statuses.some((s) => s.name === 'Increase Discipline'), 'Buff Prevent blocks the buff');
    });
    (0, node_test_1.it)("an 'Any'-typed cast cannot apply the tag (no style to lock to)", () => {
        const cast = (0, move_js_1.applyJutsu)(fighter('A'), fighter('B'), dmgJutsu('Any', [{ name: 'Increase Discipline', percent: 35 }]), 1, 'central', 1);
        node_assert_1.strict.ok(!cast.self.statuses.some((s) => s.name === 'Increase Discipline'), "typeless/'Any' casts must be a no-op");
    });
});
