"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Tag-lifecycle regression guard for the PvP engine (api/pvp/move.ts).
 *
 * Pins the rule that lingering tags do NOT fire on the turn they're cast — the
 * reported bug was "Lifesteal heals on the SAME attack, like Siphon" when it
 * should be a buff that heals a % of damage dealt over the next 2 turns.
 *
 * applyJutsu queues a deferred status (activeRound = round + 1), so:
 *   • Round 1 (cast): the Lifesteal tag is applied as a status but does NOT heal
 *     the casting attack, and Siphon (instant) DOES heal the same attack.
 *   • Round 2 (status now active): a follow-up attack heals via the Lifesteal buff.
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
// Minimal jutsu objects — only the fields applyJutsu reads. effectPower drives
// the base damage so finalDmg > 0 and the heal path is reachable.
function jutsu(tags, id = 't') {
    return {
        id, name: id, type: 'Ninjutsu', element: 'Fire',
        ap: 60, range: 1, effectPower: 30, cooldown: 0,
        chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE', tags,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    };
}
(0, node_test_1.describe)('PvP tag lifecycle — Lifesteal vs Siphon', () => {
    (0, node_test_1.it)('Lifesteal tag does NOT heal on the cast attack, but applies a deferred 2-round status', () => {
        const self = fighter('A', /* hp */ 500); // wounded so any heal is visible
        const opp = fighter('B');
        const r = (0, move_js_1.applyJutsu)(self, opp, jutsu([{ name: 'Lifesteal', percent: 30 }]), 1, 'central', 1);
        node_assert_1.strict.ok(r.opponent.hp < 1000, 'opponent should take damage');
        node_assert_1.strict.equal(r.self.hp, 500, 'caster must NOT heal on the same attack the Lifesteal is cast');
        const ls = r.self.statuses.find((s) => s.name === 'Lifesteal');
        node_assert_1.strict.ok(ls, 'a Lifesteal status should be queued on the caster');
        node_assert_1.strict.equal(ls?.rounds, 2, 'Lifesteal lasts 2 rounds');
        node_assert_1.strict.equal(ls?.activeRound, 2, 'Lifesteal is deferred to the next round (activeRound = round + 1)');
    });
    (0, node_test_1.it)('Siphon heals on the SAME attack (instant, by design)', () => {
        const self = fighter('A', 500);
        const opp = fighter('B');
        const r = (0, move_js_1.applyJutsu)(self, opp, jutsu([{ name: 'Siphon', percent: 30 }]), 1, 'central', 1);
        node_assert_1.strict.ok(r.self.hp > 500, 'Siphon should heal the caster on the same attack');
    });
    (0, node_test_1.it)('an already-active Lifesteal buff heals a follow-up attack on a later round', () => {
        const self = fighter('A', 500);
        const opp = fighter('B');
        // Round 1: cast Lifesteal (deferred to activeRound 2).
        const r1 = (0, move_js_1.applyJutsu)(self, opp, jutsu([{ name: 'Lifesteal', percent: 30 }]), 1, 'central', 1);
        const hpAfterCast = r1.self.hp;
        // Round 2: a plain damage attack — the Lifesteal buff is now active and heals.
        const r2 = (0, move_js_1.applyJutsu)(r1.self, r1.opponent, jutsu([], 'dmg'), 1, 'central', 2);
        node_assert_1.strict.ok(r2.self.hp > hpAfterCast, 'follow-up attack should heal via the now-active Lifesteal buff');
    });
});
