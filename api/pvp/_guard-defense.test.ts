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
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyJutsu } from './move.js';
import type { PvpFighter } from './session.js';

function fighter(name: string, guardDefensePct?: number): PvpFighter {
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
function dmgJutsu(tags: Array<{ name: string; percent?: number }> = [], id = 'dmg'): any {
    return {
        id, name: id, type: 'Ninjutsu', element: 'Fire',
        ap: 60, range: 1, effectPower: 30, cooldown: 0,
        chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE', tags,
    };
}

function dealtTo(opponent: PvpFighter, attacker: PvpFighter, jutsu: ReturnType<typeof dmgJutsu>): number {
    const r = applyJutsu(attacker, opponent, jutsu, 1, 'central', 1);
    return opponent.maxHp - r.opponent.hp;
}

describe('PvP Town Defense guard mitigation', () => {
    it('reduces direct jutsu damage to a guard by their sealed guardDefensePct', () => {
        const attacker = fighter('Raider');
        const base = dealtTo(fighter('Guard'), attacker, dmgJutsu());
        assert.ok(base > 0, 'baseline jutsu should deal damage');

        const guarded = dealtTo(fighter('Guard', 5), attacker, dmgJutsu());
        assert.equal(guarded, Math.floor(base * 0.95), '5% Town Defense shaves 5% off direct damage');
        assert.ok(guarded < base, 'a guard with the bonus takes strictly less damage');
    });

    it('is a no-op when the defender has no (or zero) guardDefensePct', () => {
        const attacker = fighter('Raider');
        const absent = dealtTo(fighter('B'), attacker, dmgJutsu());
        const zero = dealtTo(fighter('B', 0), attacker, dmgJutsu());
        assert.equal(absent, zero, 'absent and 0% must deal identical damage');
    });

    it('Pierce true damage bypasses the guard mitigation', () => {
        const attacker = fighter('Raider');
        const noGuard = dealtTo(fighter('G1'), attacker, dmgJutsu([{ name: 'Pierce' }], 'pierce'));
        const withGuard = dealtTo(fighter('G2', 5), attacker, dmgJutsu([{ name: 'Pierce' }], 'pierce'));
        assert.equal(noGuard, withGuard, 'Pierce ignores guard mitigation');
    });
});
