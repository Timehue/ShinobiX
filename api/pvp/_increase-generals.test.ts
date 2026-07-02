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
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyJutsu } from './move.js';
import type { PvpFighter, PvpStatus } from './session.js';

function fighter(name: string, statuses: PvpStatus[] = []): PvpFighter {
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
function dmgJutsu(tags: Array<{ name: string; percent?: number }> = []) {
    return {
        id: 'dmg', name: 'dmg', type: 'Ninjutsu', element: 'Fire',
        ap: 60, range: 1, effectPower: 30, cooldown: 0,
        chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE', tags,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

// Active (non-deferred) Increase Generals status at a given percent.
function ig(percent: number): PvpStatus {
    return { name: 'Increase Generals', percent, rounds: 2, kind: 'positive' } as PvpStatus;
}

// Damage a cast deals to the opponent (hp lost).
function dealt(self: PvpFighter, opp: PvpFighter): number {
    const r = applyJutsu(self, opp, dmgJutsu(), 1, 'central', 1);
    return opp.hp - r.opponent.hp;
}

describe('Increase Generals — combat effect', () => {
    it('raises the caster\'s damage dealt (offense side)', () => {
        const base = dealt(fighter('A'), fighter('B'));
        const buffed = dealt(fighter('A', [ig(30)]), fighter('B'));
        assert.ok(buffed > base, `buffed attack (${buffed}) should exceed baseline (${base})`);
    });

    it('lowers the damage the buffed fighter takes (defense side)', () => {
        const base = dealt(fighter('A'), fighter('B'));
        const vsBuffedDefender = dealt(fighter('A'), fighter('B', [ig(30)]));
        assert.ok(vsBuffedDefender < base, `hit on a Generals-buffed defender (${vsBuffedDefender}) should be below baseline (${base})`);
    });

    it('is suppressed while the buffed fighter is Bloodline-Sealed', () => {
        const base = dealt(fighter('A'), fighter('B'));
        const sealed = dealt(
            fighter('A', [ig(30), { name: 'Bloodline Seal', rounds: 2, kind: 'negative' } as PvpStatus]),
            fighter('B'),
        );
        assert.equal(sealed, base, 'a sealed fighter gets no Increase Generals lift');
    });

    it('stacks with diminishing returns (2 stacks < 2× a single stack over baseline)', () => {
        const base = dealt(fighter('A'), fighter('B'));
        const one = dealt(fighter('A', [ig(30)]), fighter('B')) - base;
        const two = dealt(fighter('A', [ig(30), ig(30)]), fighter('B')) - base;
        assert.ok(two > one, 'two stacks should out-hit one');
        assert.ok(two < one * 2, `two stacks (${two}) must be sub-linear vs one (${one}) — the K_GENERALS pool`);
    });

    it('casting the tag applies a deferred 2-round positive status, Buff-Prevent-gated', () => {
        const cast = applyJutsu(fighter('A'), fighter('B'), dmgJutsu([{ name: 'Increase Generals', percent: 30 }]), 1, 'central', 1);
        const st = cast.self.statuses.find((s) => s.name === 'Increase Generals');
        assert.ok(st, 'an Increase Generals status should be queued on the caster');
        assert.equal(st?.rounds, 2, 'lasts 2 rounds');
        assert.equal(st?.activeRound, 2, 'deferred to next round (does not boost its own cast)');

        // Buff Prevent on the caster blocks the application.
        const prevented = applyJutsu(
            fighter('A', [{ name: 'Buff Prevent', rounds: 2, kind: 'negative' } as PvpStatus]),
            fighter('B'),
            dmgJutsu([{ name: 'Increase Generals', percent: 30 }]), 1, 'central', 1,
        );
        assert.ok(!prevented.self.statuses.some((s) => s.name === 'Increase Generals'), 'Buff Prevent blocks the buff');
    });
});
