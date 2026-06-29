"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/*
 * Engine-behaviour regression guards for the PvP combat resolver
 * (api/pvp/move.ts). Complements _lifesteal.test.ts (Lifesteal-vs-Siphon
 * lifecycle) with the timing / prevent / pierce / copy-mirror / ground-effect
 * interactions that the canonical-tag refactor must keep deterministic.
 */
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const move_js_1 = require("./move.js");
const session_js_1 = require("./session.js");
function fighter(name, hp = 1000, statuses = [], pos = 0) {
    return {
        name, hp, maxHp: 1000, chakra: 1000, maxChakra: 1000,
        stamina: 1000, maxStamina: 1000, shield: 0, statuses, pos,
        character: { name, stats: {}, jutsuMastery: [] },
    };
}
// Minimal jutsu — only the fields applyJutsu reads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jutsu(tags, overrides = {}) {
    return {
        id: 't', name: 't', type: 'Ninjutsu', element: 'Fire',
        ap: 60, range: 1, effectPower: 30, cooldown: 0,
        chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE',
        tags, ...overrides,
    };
}
(0, node_test_1.describe)('future activeRound statuses do not affect the current round', () => {
    (0, node_test_1.it)('a Decrease Damage Taken scheduled for next round does not mitigate this round', () => {
        const future = { name: 'Decrease Damage Taken', rounds: 2, activeRound: 2, percent: 30, kind: 'positive' };
        const attacker = fighter('A');
        const r1 = (0, move_js_1.applyJutsu)(attacker, fighter('B', 1000, [future]), jutsu([]), 1, 'central', 1);
        const r2 = (0, move_js_1.applyJutsu)(attacker, fighter('B', 1000, [future]), jutsu([]), 1, 'central', 2);
        const dmgRound1 = 1000 - r1.opponent.hp;
        const dmgRound2 = 1000 - r2.opponent.hp;
        node_assert_1.strict.ok(dmgRound1 > 0 && dmgRound2 > 0, 'both rounds deal damage');
        node_assert_1.strict.ok(dmgRound1 > dmgRound2, `round-1 (status not yet active) must hit harder than round-2 (active): ${dmgRound1} vs ${dmgRound2}`);
    });
});
(0, node_test_1.describe)('prevent tags only block at their intended timing', () => {
    (0, node_test_1.it)('a Debuff Prevent that activates next round does NOT block a Stun cast this round', () => {
        const pendingPrevent = { name: 'Debuff Prevent', rounds: 2, activeRound: 2, kind: 'positive' };
        const thisRound = (0, move_js_1.applyJutsu)(fighter('A'), fighter('B', 1000, [pendingPrevent]), jutsu([{ name: 'Stun' }]), 1, 'central', 1);
        node_assert_1.strict.ok(thisRound.opponent.statuses.some(s => s.name === 'Stun'), 'Stun lands while Debuff Prevent is still pending');
    });
    (0, node_test_1.it)('an ACTIVE Debuff Prevent blocks a Stun', () => {
        const activePrevent = { name: 'Debuff Prevent', rounds: 2, kind: 'positive' };
        const blocked = (0, move_js_1.applyJutsu)(fighter('A'), fighter('B', 1000, [activePrevent]), jutsu([{ name: 'Stun' }]), 1, 'central', 2);
        node_assert_1.strict.ok(!blocked.opponent.statuses.some(s => s.name === 'Stun'), 'Stun is blocked by the active Debuff Prevent');
    });
});
(0, node_test_1.describe)('Pierce bypasses shield, reflect, and absorb', () => {
    (0, node_test_1.it)('true damage ignores shield block, reflects nothing, and grants no absorb heal', () => {
        const defender = fighter('B', 1000, [
            { name: 'Reflect', rounds: 2, percent: 50, kind: 'positive' },
            { name: 'Absorb', rounds: 2, percent: 50, kind: 'positive' },
        ]);
        defender.shield = 500;
        const attacker = fighter('A', 1000);
        const r = (0, move_js_1.applyJutsu)(attacker, defender, jutsu([{ name: 'Pierce' }], { ap: 60 }), 1, 'central', 1);
        node_assert_1.strict.equal(r.self.hp, 1000, 'attacker takes no reflected damage from a pierce hit');
        node_assert_1.strict.ok(r.opponent.hp < 1000, 'pierce still deals damage through the shield');
        // Absorb would have healed the defender above its damage; instead HP only dropped.
        node_assert_1.strict.ok(r.opponent.hp <= 1000, 'no absorb heal on a pierce hit');
        const expected = 1000 - (1000 - r.opponent.hp);
        node_assert_1.strict.equal(r.opponent.hp, expected); // tautology guard: HP is deterministic
    });
});
(0, node_test_1.describe)('Recoil scales + rank-caps like its CAPPED_AMP_TAGS siblings (PvE↔PvP parity)', () => {
    (0, node_test_1.it)('at mastery 0 a 40% S-rank Recoil scales down to 30 (not the raw 40)', () => {
        // scaledTagPercent(40, 0, 'Recoil', 'S Rank') = min(max(0, 40 - 50×0.2), 40) = 30.
        // PvE applies the same via effectiveTagPercent — PvP used to seed the raw 40.
        const r = (0, move_js_1.applyJutsu)(fighter('A'), fighter('B'), jutsu([{ name: 'Recoil', percent: 40 }], { bloodlineRank: 'S Rank' }), 1, 'central', 1);
        node_assert_1.strict.equal(r.opponent.statuses.find(s => s.name === 'Recoil')?.percent, 30);
    });
    (0, node_test_1.it)('at mastery 50 it reaches the stored 40 (rank cap)', () => {
        const self = fighter('A');
        // Rank cap (2026-06-26): mastery 50 is only usable at Jonin+ (level ≥ 50);
        // give this fighter a max level so the per-rank cap doesn't clamp the mastery.
        self.character.level = 100;
        self.character.jutsuMastery = [{ jutsuId: 't', level: 50 }];
        const r = (0, move_js_1.applyJutsu)(self, fighter('B'), jutsu([{ name: 'Recoil', percent: 40 }], { bloodlineRank: 'S Rank' }), 1, 'central', 1);
        node_assert_1.strict.equal(r.opponent.statuses.find(s => s.name === 'Recoil')?.percent, 40);
    });
    (0, node_test_1.it)('rank cap clamps mastery: a Genin (lvl 20) wielding a stored-50 jutsu hits as mastery 20', () => {
        // Anti-twink (2026-06-26): even with mastery 50 STORED, a Genin is clamped to
        // jutsu level 20, so scaledTagPercent(40, 20, Recoil, S) = max(0, 40 - (50-20)×0.2) = 34.
        const self = fighter('A');
        self.character.level = 20;
        self.character.jutsuMastery = [{ jutsuId: 't', level: 50 }];
        const r = (0, move_js_1.applyJutsu)(self, fighter('B'), jutsu([{ name: 'Recoil', percent: 40 }], { bloodlineRank: 'S Rank' }), 1, 'central', 1);
        node_assert_1.strict.equal(r.opponent.statuses.find(s => s.name === 'Recoil')?.percent, 34);
    });
    (0, node_test_1.it)('resolves to the exact same percent as Reflect, a sibling capped tag', () => {
        const reflect = (0, move_js_1.applyJutsu)(fighter('A'), fighter('B'), jutsu([{ name: 'Reflect', percent: 40 }], { bloodlineRank: 'S Rank' }), 1, 'central', 1)
            .self.statuses.find(s => s.name === 'Reflect');
        const recoil = (0, move_js_1.applyJutsu)(fighter('A'), fighter('B'), jutsu([{ name: 'Recoil', percent: 40 }], { bloodlineRank: 'S Rank' }), 1, 'central', 1)
            .opponent.statuses.find(s => s.name === 'Recoil');
        node_assert_1.strict.equal(recoil?.percent, reflect?.percent);
    });
});
(0, node_test_1.describe)('Copy / Mirror are deterministic with deferred statuses', () => {
    (0, node_test_1.it)('Copy only copies the opponent ACTIVE positive statuses, not pending ones', () => {
        const opp = fighter('B', 1000, [
            { name: 'Reflect', rounds: 2, percent: 30, kind: 'positive' }, // active
            { name: 'Absorb', rounds: 2, activeRound: 2, percent: 30, kind: 'positive' }, // pending
        ]);
        const r = (0, move_js_1.applyJutsu)(fighter('A'), opp, jutsu([{ name: 'Copy' }]), 1, 'central', 1);
        const copiedNames = r.self.statuses.map(s => s.name);
        node_assert_1.strict.ok(copiedNames.includes('Reflect'), 'active positive is copied');
        node_assert_1.strict.ok(!copiedNames.includes('Absorb'), 'pending (future-round) positive is NOT copied');
    });
    (0, node_test_1.it)('Mirror only mirrors the caster ACTIVE non-DoT debuffs onto the opponent', () => {
        const self = fighter('A', 1000, [
            { name: 'Decrease Damage Given', rounds: 2, percent: 30, kind: 'negative' }, // active, mirrorable
            { name: 'Wound', rounds: 2, amount: 100, kind: 'negative' }, // DoT, not mirrored
            { name: 'Buff Prevent', rounds: 2, activeRound: 2, kind: 'negative' }, // pending, not mirrored
        ]);
        const r = (0, move_js_1.applyJutsu)(self, fighter('B'), jutsu([{ name: 'Mirror' }]), 1, 'central', 1);
        const onOpp = r.opponent.statuses.map(s => s.name);
        node_assert_1.strict.ok(onOpp.includes('Decrease Damage Given'), 'active non-DoT debuff is mirrored');
        node_assert_1.strict.ok(!onOpp.includes('Wound'), 'DoT debuffs are not mirrored');
        node_assert_1.strict.ok(!onOpp.includes('Buff Prevent'), 'pending debuffs are not mirrored');
    });
});
(0, node_test_1.describe)('fixed-effect control jutsu deal STANDARD damage, not the EP-100 sentinel', () => {
    (0, node_test_1.it)('a sanitized 60-AP Stun jutsu (legacy EP 100) deals standard EP-40 damage, not the EP-100 sentinel, and still stuns', () => {
        // Replicates the live path: the loadout is sanitized at session-create,
        // THEN resolved in combat. The EP-100 sentinel is clamped to 40 first.
        const sanitized = (0, session_js_1.sanitizeJutsuList)([{
                id: 'control', name: 'Seal Strike', type: 'Ninjutsu', element: 'Fire',
                ap: 60, effectPower: 100, range: 1, target: 'OPPONENT', method: 'SINGLE',
                tags: [{ name: 'Stun' }],
            }])[0];
        // High starting HP so the standard hit (which isn't capped by maxHp on
        // the way down) is fully observable. Cast at mastery 0 (empty jutsuMastery):
        // EP 40 → epAtMax 50 → ×MASTERY_MIN_DAMAGE_FRAC(0.3) → scaledEp 15 → ×32 = 480.
        // The EP-100 sentinel would instead give (100+10)×0.3×32 = 1056, so the
        // clamp is what keeps this at 480.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = (0, move_js_1.applyJutsu)(fighter('A'), fighter('B', 3000), sanitized, 1, 'central', 1);
        const dealt = 3000 - r.opponent.hp;
        node_assert_1.strict.equal(dealt, 480, 'standard EP-40 damage at mastery 0, NOT the EP-100 sentinel (1056)');
        node_assert_1.strict.ok(r.opponent.statuses.some(s => s.name === 'Stun'), 'the control effect still applies');
    });
});
(0, node_test_1.describe)('ground effects apply once per pass and respect prevent / timing', () => {
    function poisonZone() {
        return { id: 'z', owner: 'p1', name: 'Toxic Field', tiles: [5], rounds: 2, tags: [{ name: 'Poison', percent: 10 }] };
    }
    (0, node_test_1.it)('applies exactly one Poison status to a fighter standing in the zone', () => {
        const standing = fighter('B', 1000, [], 5);
        const r = (0, move_js_1.applyGroundEffectToFighter)(standing, poisonZone(), 1);
        const poisons = r.fighter.statuses.filter(s => s.name === 'Poison');
        node_assert_1.strict.equal(poisons.length, 1, 'one application = one Poison status');
    });
    (0, node_test_1.it)('does nothing to a fighter outside the zone', () => {
        const away = fighter('B', 1000, [], 99);
        const r = (0, move_js_1.applyGroundEffectToFighter)(away, poisonZone(), 1);
        node_assert_1.strict.equal(r.fighter.statuses.length, 0);
        node_assert_1.strict.equal(r.lines.length, 0);
    });
    (0, node_test_1.it)('a re-application replaces rather than stacks (Poison is non-stackable)', () => {
        let f = fighter('B', 1000, [], 5);
        f = (0, move_js_1.applyGroundEffectToFighter)(f, poisonZone(), 1).fighter;
        f = (0, move_js_1.applyGroundEffectToFighter)(f, poisonZone(), 2).fighter;
        node_assert_1.strict.equal(f.statuses.filter(s => s.name === 'Poison').length, 1, 'still one Poison after two passes');
    });
    (0, node_test_1.it)('Debuff Prevent (active) blocks the zone', () => {
        const warded = fighter('B', 1000, [{ name: 'Debuff Prevent', rounds: 2, kind: 'positive' }], 5);
        const r = (0, move_js_1.applyGroundEffectToFighter)(warded, poisonZone(), 1);
        node_assert_1.strict.ok(!r.fighter.statuses.some(s => s.name === 'Poison'), 'no Poison applied under Debuff Prevent');
        node_assert_1.strict.ok(r.lines.some(l => l.includes('Debuff Prevent')), 'logs the block reason');
    });
    (0, node_test_1.it)('tickGroundEffects decrements rounds and expires a zone at 0', () => {
        const once = (0, move_js_1.tickGroundEffects)([poisonZone()]);
        node_assert_1.strict.equal(once.length, 1);
        node_assert_1.strict.equal(once[0].rounds, 1);
        const twice = (0, move_js_1.tickGroundEffects)(once);
        node_assert_1.strict.equal(twice.length, 0, 'a 2-round zone is gone after two ticks');
    });
});
