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
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyJutsu } from './move.js';
import type { PvpFighter } from './session.js';

function fighter(name: string, homeTerrainType?: string): PvpFighter {
    return {
        name, hp: 100000, maxHp: 100000, chakra: 1000, maxChakra: 1000,
        stamina: 1000, maxStamina: 1000, shield: 0, statuses: [], pos: 0,
        character: { name, stats: {}, jutsuMastery: [], ...(homeTerrainType ? { homeTerrainType } : {}) },
    };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asJutsu(j: Record<string, unknown>): any {
    return { type: 'Taijutsu', range: 1, cooldown: 0, chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE', tags: [], ...j };
}
// Damage a single cast deals to a fresh 100k-HP dummy (big HP so no KO branch).
function dmg(self: PvpFighter, jutsu: Record<string, unknown>): number {
    const opp = fighter('Dummy');
    const r = applyJutsu(self, opp, asJutsu(jutsu), 1, 'central', 1);
    return 100000 - r.opponent.hp;
}

describe('PvP home-terrain buff', () => {
    const J = { id: 'tai-strike', name: 'Palm Strike', ap: 60, effectPower: 100 };

    it('a matching jutsu type on the clan-owned sector deals +10%', () => {
        const base = dmg(fighter('A'), J);                 // no homeTerrainType sealed
        const buffed = dmg(fighter('A', 'Taijutsu'), J);   // Taijutsu terrain sealed
        assert.ok(base > 0, `base damage should be > 0 (got ${base})`);
        assert.ok(buffed > base, `buffed (${buffed}) should exceed base (${base})`);
        assert.ok(Math.abs(buffed / base - 1.1) < 0.02, `expected ~1.1x, got ${(buffed / base).toFixed(3)}x`);
    });

    it('a non-matching jutsu type gets no home-terrain bonus', () => {
        const base = dmg(fighter('A'), { ...J, type: 'Ninjutsu' });
        const withBuff = dmg(fighter('A', 'Taijutsu'), { ...J, type: 'Ninjutsu' });
        assert.equal(withBuff, base, 'a Ninjutsu cast must not benefit from a Taijutsu terrain buff');
    });

    it('no sealed homeTerrainType leaves damage unchanged (default sessions unaffected)', () => {
        assert.equal(dmg(fighter('A'), J), dmg(fighter('B'), J), 'two unbuffed fighters deal identical base damage');
    });
});
