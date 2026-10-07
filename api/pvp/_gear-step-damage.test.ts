/**
 * Gear step weapons carry fractional EP (14.5, 17.5, ...). This pins that the REAL
 * damage function turns each half point into more damage, so a step is a true
 * upgrade between its tier and the next one and never an equal or lower hit.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyJutsu } from './move.js';
import { ITEM_CATALOG } from './_item-catalog.js';
import { isStepItemId, parseStepItemId } from '../../shared/gear-steps.js';
import type { PvpFighter } from './session.js';

function fighter(name: string, character: Record<string, unknown> = {}): PvpFighter {
    return {
        name, hp: 100_000, maxHp: 100_000, chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000,
        shield: 0, statuses: [], pos: 0, character: { name, stats: {}, jutsuMastery: [], ...character },
    };
}

/** HP lost by one weapon swing of the given EP, at the mastery a Jonin swing resolves at. */
function swingDamage(effectPower: number): number {
    const self = fighter('A', { level: 100, jutsuMastery: [{ jutsuId: 'weapon', level: 50 }] });
    const jutsu = {
        id: 'weapon', name: 'Blade', weaponSwing: true, isUtility: false, ap: 40, effectPower,
        type: 'Bukijutsu', range: 1, cooldown: 0, chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE', tags: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const result = applyJutsu(self, fighter('B'), jutsu, 1, 'central', 1);
    return 100_000 - result.opponent.hp;
}

describe('gear step weapon damage', () => {
    it('every half point of EP deals strictly more damage, from tier base to tier base', () => {
        for (const [from, to] of [[14, 17], [17, 19], [19, 22]]) {
            let last = swingDamage(from);
            assert.ok(last > 0, `EP ${from} must hit`);
            for (let ep = from + 0.5; ep <= to; ep += 0.5) {
                const dealt = swingDamage(ep);
                assert.ok(dealt > last, `EP ${ep} deals ${dealt}, not more than ${last}`);
                last = dealt;
            }
        }
    });

    it('a step item swings for less than the next tier base and more than its own base', () => {
        for (const item of Object.values(ITEM_CATALOG)) {
            if (!isStepItemId(item.id) || item.slot !== 'hand') continue;
            const base = ITEM_CATALOG[parseStepItemId(item.id)!.baseId];
            const nextBase = { common: 17, rare: 19, epic: 22 }[item.rarity as 'common' | 'rare' | 'epic'];
            const dealt = swingDamage(item.weaponEp!);
            assert.ok(dealt > swingDamage(base.weaponEp!), `${item.id} must out-hit ${base.id}`);
            assert.ok(dealt < swingDamage(nextBase), `${item.id} must stay under the next tier`);
        }
    });

    it('never out-hits a legendary weapon', () => {
        const legendary = swingDamage(22);
        for (const item of Object.values(ITEM_CATALOG)) {
            if (isStepItemId(item.id) && item.slot === 'hand') assert.ok(swingDamage(item.weaponEp!) < legendary, item.id);
        }
    });
});
