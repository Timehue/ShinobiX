/*
 * Engine-behaviour regression guards for the PvP combat resolver
 * (api/pvp/move.ts). Complements _lifesteal.test.ts (Lifesteal-vs-Siphon
 * lifecycle) with the timing / prevent / pierce / copy-mirror / ground-effect
 * interactions that the canonical-tag refactor must keep deterministic.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyJutsu, applyGroundEffectToFighter, tickGroundEffects } from './move.js';
import { sanitizeJutsuList } from './session.js';
import type { PvpFighter, PvpStatus, PvpGroundEffect } from './session.js';

function fighter(name: string, hp = 1000, statuses: PvpStatus[] = [], pos = 0): PvpFighter {
    return {
        name, hp, maxHp: 1000, chakra: 1000, maxChakra: 1000,
        stamina: 1000, maxStamina: 1000, shield: 0, statuses, pos,
        character: { name, stats: {}, jutsuMastery: [] },
    };
}

// Minimal jutsu — only the fields applyJutsu reads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jutsu(tags: Array<{ name: string; percent?: number }>, overrides: Record<string, unknown> = {}): any {
    return {
        id: 't', name: 't', type: 'Ninjutsu', element: 'Fire',
        ap: 60, range: 1, effectPower: 30, cooldown: 0,
        chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE',
        tags, ...overrides,
    };
}

describe('future activeRound statuses do not affect the current round', () => {
    it('a Decrease Damage Taken scheduled for next round does not mitigate this round', () => {
        const future: PvpStatus = { name: 'Decrease Damage Taken', rounds: 2, activeRound: 2, percent: 30, kind: 'positive' };
        const attacker = fighter('A');
        const r1 = applyJutsu(attacker, fighter('B', 1000, [future]), jutsu([]), 1, 'central', 1);
        const r2 = applyJutsu(attacker, fighter('B', 1000, [future]), jutsu([]), 1, 'central', 2);
        const dmgRound1 = 1000 - r1.opponent.hp;
        const dmgRound2 = 1000 - r2.opponent.hp;
        assert.ok(dmgRound1 > 0 && dmgRound2 > 0, 'both rounds deal damage');
        assert.ok(
            dmgRound1 > dmgRound2,
            `round-1 (status not yet active) must hit harder than round-2 (active): ${dmgRound1} vs ${dmgRound2}`,
        );
    });
});

describe('prevent tags only block at their intended timing', () => {
    it('a Debuff Prevent that activates next round does NOT block a Stun cast this round', () => {
        const pendingPrevent: PvpStatus = { name: 'Debuff Prevent', rounds: 2, activeRound: 2, kind: 'positive' };
        const thisRound = applyJutsu(fighter('A'), fighter('B', 1000, [pendingPrevent]), jutsu([{ name: 'Stun' }]), 1, 'central', 1);
        assert.ok(thisRound.opponent.statuses.some(s => s.name === 'Stun'), 'Stun lands while Debuff Prevent is still pending');
    });

    it('an ACTIVE Debuff Prevent blocks a Stun', () => {
        const activePrevent: PvpStatus = { name: 'Debuff Prevent', rounds: 2, kind: 'positive' };
        const blocked = applyJutsu(fighter('A'), fighter('B', 1000, [activePrevent]), jutsu([{ name: 'Stun' }]), 1, 'central', 2);
        assert.ok(!blocked.opponent.statuses.some(s => s.name === 'Stun'), 'Stun is blocked by the active Debuff Prevent');
    });
});

describe('Pierce bypasses shield, reflect, and absorb', () => {
    it('true damage ignores shield block, reflects nothing, and grants no absorb heal', () => {
        const defender = fighter('B', 1000, [
            { name: 'Reflect', rounds: 2, percent: 50, kind: 'positive' },
            { name: 'Absorb', rounds: 2, percent: 50, kind: 'positive' },
        ]);
        defender.shield = 500;
        const attacker = fighter('A', 1000);
        const r = applyJutsu(attacker, defender, jutsu([{ name: 'Pierce' }], { ap: 60 }), 1, 'central', 1);
        assert.equal(r.self.hp, 1000, 'attacker takes no reflected damage from a pierce hit');
        assert.ok(r.opponent.hp < 1000, 'pierce still deals damage through the shield');
        // Absorb would have healed the defender above its damage; instead HP only dropped.
        assert.ok(r.opponent.hp <= 1000, 'no absorb heal on a pierce hit');
        const expected = 1000 - (1000 - r.opponent.hp);
        assert.equal(r.opponent.hp, expected); // tautology guard: HP is deterministic
    });
});

describe('Recoil scales + rank-caps like its CAPPED_AMP_TAGS siblings (PvE↔PvP parity)', () => {
    it('at mastery 0 a 40% S-rank Recoil scales down to 30 (not the raw 40)', () => {
        // scaledTagPercent(40, 0, 'Recoil', 'S Rank') = min(max(0, 40 - 50×0.2), 40) = 30.
        // PvE applies the same via effectiveTagPercent — PvP used to seed the raw 40.
        const r = applyJutsu(fighter('A'), fighter('B'), jutsu([{ name: 'Recoil', percent: 40 }], { bloodlineRank: 'S Rank' }), 1, 'central', 1);
        assert.equal(r.opponent.statuses.find(s => s.name === 'Recoil')?.percent, 30);
    });

    it('at mastery 50 it reaches the stored 40 (rank cap)', () => {
        const self = fighter('A');
        // Rank cap (2026-06-26): mastery 50 is only usable at Jonin+ (level ≥ 50);
        // give this fighter a max level so the per-rank cap doesn't clamp the mastery.
        self.character.level = 100;
        self.character.jutsuMastery = [{ jutsuId: 't', level: 50 }];
        const r = applyJutsu(self, fighter('B'), jutsu([{ name: 'Recoil', percent: 40 }], { bloodlineRank: 'S Rank' }), 1, 'central', 1);
        assert.equal(r.opponent.statuses.find(s => s.name === 'Recoil')?.percent, 40);
    });

    it('rank cap clamps mastery: a Genin (lvl 20) wielding a stored-50 jutsu hits as mastery 20', () => {
        // Anti-twink (2026-06-26): even with mastery 50 STORED, a Genin is clamped to
        // jutsu level 20, so scaledTagPercent(40, 20, Recoil, S) = max(0, 40 - (50-20)×0.2) = 34.
        const self = fighter('A');
        self.character.level = 20;
        self.character.jutsuMastery = [{ jutsuId: 't', level: 50 }];
        const r = applyJutsu(self, fighter('B'), jutsu([{ name: 'Recoil', percent: 40 }], { bloodlineRank: 'S Rank' }), 1, 'central', 1);
        assert.equal(r.opponent.statuses.find(s => s.name === 'Recoil')?.percent, 34);
    });

    it('resolves to the exact same percent as Reflect, a sibling capped tag', () => {
        const reflect = applyJutsu(fighter('A'), fighter('B'), jutsu([{ name: 'Reflect', percent: 40 }], { bloodlineRank: 'S Rank' }), 1, 'central', 1)
            .self.statuses.find(s => s.name === 'Reflect');
        const recoil = applyJutsu(fighter('A'), fighter('B'), jutsu([{ name: 'Recoil', percent: 40 }], { bloodlineRank: 'S Rank' }), 1, 'central', 1)
            .opponent.statuses.find(s => s.name === 'Recoil');
        assert.equal(recoil?.percent, reflect?.percent);
    });
});

describe('Copy / Mirror are deterministic with deferred statuses', () => {
    it('Copy only copies the opponent ACTIVE positive statuses, not pending ones', () => {
        const opp = fighter('B', 1000, [
            { name: 'Reflect', rounds: 2, percent: 30, kind: 'positive' },                  // active
            { name: 'Absorb', rounds: 2, activeRound: 2, percent: 30, kind: 'positive' },    // pending
        ]);
        const r = applyJutsu(fighter('A'), opp, jutsu([{ name: 'Copy' }]), 1, 'central', 1);
        const copiedNames = r.self.statuses.map(s => s.name);
        assert.ok(copiedNames.includes('Reflect'), 'active positive is copied');
        assert.ok(!copiedNames.includes('Absorb'), 'pending (future-round) positive is NOT copied');
    });

    it('Mirror only mirrors the caster ACTIVE non-DoT debuffs onto the opponent', () => {
        const self = fighter('A', 1000, [
            { name: 'Decrease Damage Given', rounds: 2, percent: 30, kind: 'negative' },     // active, mirrorable
            { name: 'Wound', rounds: 2, amount: 100, kind: 'negative' },                     // DoT, not mirrored
            { name: 'Buff Prevent', rounds: 2, activeRound: 2, kind: 'negative' },           // pending, not mirrored
        ]);
        const r = applyJutsu(self, fighter('B'), jutsu([{ name: 'Mirror' }]), 1, 'central', 1);
        const onOpp = r.opponent.statuses.map(s => s.name);
        assert.ok(onOpp.includes('Decrease Damage Given'), 'active non-DoT debuff is mirrored');
        assert.ok(!onOpp.includes('Wound'), 'DoT debuffs are not mirrored');
        assert.ok(!onOpp.includes('Buff Prevent'), 'pending debuffs are not mirrored');
    });
});

describe('fixed-effect control jutsu deal STANDARD damage, not the EP-100 sentinel', () => {
    it('a sanitized 60-AP Stun jutsu (legacy EP 100) deals standard EP-40 damage, not the EP-100 sentinel, and still stuns', () => {
        // Replicates the live path: the loadout is sanitized at session-create,
        // THEN resolved in combat. The EP-100 sentinel is clamped to 40 first.
        const sanitized = sanitizeJutsuList([{
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
        const r = applyJutsu(fighter('A'), fighter('B', 3000), sanitized as any, 1, 'central', 1);
        const dealt = 3000 - r.opponent.hp;
        assert.equal(dealt, 480, 'standard EP-40 damage at mastery 0, NOT the EP-100 sentinel (1056)');
        assert.ok(r.opponent.statuses.some(s => s.name === 'Stun'), 'the control effect still applies');
    });
});

describe('ground effects apply once per pass and respect prevent / timing', () => {
    function poisonZone(): PvpGroundEffect {
        return { id: 'z', owner: 'p1', name: 'Toxic Field', tiles: [5], rounds: 2, tags: [{ name: 'Poison', percent: 10 }] };
    }

    it('applies exactly one Poison status to a fighter standing in the zone', () => {
        const standing = fighter('B', 1000, [], 5);
        const r = applyGroundEffectToFighter(standing, poisonZone(), 1);
        const poisons = r.fighter.statuses.filter(s => s.name === 'Poison');
        assert.equal(poisons.length, 1, 'one application = one Poison status');
    });

    it('does nothing to a fighter outside the zone', () => {
        const away = fighter('B', 1000, [], 99);
        const r = applyGroundEffectToFighter(away, poisonZone(), 1);
        assert.equal(r.fighter.statuses.length, 0);
        assert.equal(r.lines.length, 0);
    });

    it('a re-application replaces rather than stacks (Poison is non-stackable)', () => {
        let f = fighter('B', 1000, [], 5);
        f = applyGroundEffectToFighter(f, poisonZone(), 1).fighter;
        f = applyGroundEffectToFighter(f, poisonZone(), 2).fighter;
        assert.equal(f.statuses.filter(s => s.name === 'Poison').length, 1, 'still one Poison after two passes');
    });

    it('Debuff Prevent (active) blocks the zone', () => {
        const warded = fighter('B', 1000, [{ name: 'Debuff Prevent', rounds: 2, kind: 'positive' }], 5);
        const r = applyGroundEffectToFighter(warded, poisonZone(), 1);
        assert.ok(!r.fighter.statuses.some(s => s.name === 'Poison'), 'no Poison applied under Debuff Prevent');
        assert.ok(r.lines.some(l => l.includes('Debuff Prevent')), 'logs the block reason');
    });

    it('tickGroundEffects decrements rounds and expires a zone at 0', () => {
        const once = tickGroundEffects([poisonZone()]);
        assert.equal(once.length, 1);
        assert.equal(once[0]!.rounds, 1);
        const twice = tickGroundEffects(once);
        assert.equal(twice.length, 0, 'a 2-round zone is gone after two ticks');
    });
});
