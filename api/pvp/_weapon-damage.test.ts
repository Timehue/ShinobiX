/**
 * Regression guard: PvP weapon attacks must deal damage (api/pvp/move.ts).
 *
 * The bug: hand weapons omit `apCost`, so the weapon synth got `ap: 40` (the
 * default). With no `isUtility` flag, that tripped the legacy 40-AP "zero-damage
 * utility" rule (isZeroDamageFortyApJutsu) and the weapon dealt ZERO base damage
 * in PvP — while PvE was exempt (its synth uses an 'item-' id). The fix sets
 * `isUtility: false` on the weapon synth. These tests pin BOTH directions:
 *   • a weapon (isUtility:false, ap:40) deals weaponEp-scaled damage, and
 *   • a genuine 40-AP utility jutsu (isUtility undefined, non-exempt id) still
 *     deals zero damage — so the fix didn't disable the utility rule itself.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyJutsu } from './move.js';
import type { PvpFighter } from './session.js';

function fighter(name: string, hp = 1000): PvpFighter {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asJutsu(j: Record<string, unknown>): any {
    return { type: 'Bukijutsu', range: 1, cooldown: 0, chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE', tags: [], ...j };
}

describe('PvP weapon damage', () => {
    it('a 40-AP weapon (isUtility:false) deals weaponEp-scaled damage', () => {
        const self = fighter('A');
        const opp = fighter('B');
        // Mirrors the weapon synth in move.ts: id 'weapon', ap 40, isUtility false.
        const r = applyJutsu(self, opp, asJutsu({ id: 'weapon', name: 'Katana', isUtility: false, ap: 40, effectPower: 18 }), 1, 'central', 1);
        assert.ok(r.opponent.hp < 1000, `weapon should deal damage, opponent hp=${r.opponent.hp}`);
    });

    it('a genuine 40-AP utility jutsu still deals ZERO base damage (rule intact)', () => {
        const self = fighter('A');
        const opp = fighter('B');
        const r = applyJutsu(self, opp, asJutsu({ id: 'buff-x', name: 'Utility', ap: 40, effectPower: 18 }), 1, 'central', 1);
        assert.equal(r.opponent.hp, 1000, 'a 40-AP non-exempt jutsu with no isUtility flag must deal 0 base damage');
    });

    it('the basic attack (id basic-attack, ap 40) still deals damage', () => {
        const self = fighter('A');
        const opp = fighter('B');
        const r = applyJutsu(self, opp, asJutsu({ id: 'basic-attack', name: 'Basic Attack', ap: 40, effectPower: 10 }), 1, 'central', 1);
        assert.ok(r.opponent.hp < 1000, `basic attack should deal damage, opponent hp=${r.opponent.hp}`);
    });
});
