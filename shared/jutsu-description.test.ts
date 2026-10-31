import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { interpolateJutsuPercentages } from './jutsu-description.js';
import { resolveCastFlavor } from '../api/combat-core/cast-flavor.js';
import { jutsuDetailDescription, jutsuDisplayAtLevel } from '../shinobij.client/src/lib/jutsu-effects.js';
import type { Jutsu } from '../shinobij.client/src/types/combat.js';

const technique = (overrides: Partial<Jutsu> = {}): Jutsu => ({
    id: 'dynamic-bloodline', name: 'Blood Gaze', type: 'Genjutsu', element: 'Blood',
    ap: 60, range: 4, effectPower: 30, cooldown: 7, chakraCost: 100, staminaCost: 100,
    target: 'OPPONENT', method: 'SINGLE', bloodlineRank: 'A Rank',
    battleDescription: '%user weakens %target by %tag1 and poisons them at %tag2.',
    tags: [{ name: 'Increase Damage Taken', percent: 35 }, { name: 'Poison', percent: 12 }],
    ...overrides,
});

describe('dynamic bloodline description percentages', () => {
    it('shows the current mastery values in both details and battle logs, without changing source data', () => {
        const jutsu = technique();
        const original = JSON.stringify(jutsu);
        for (const [level, expected] of [[0, [25, 8]], [25, [30, 10]], [50, [35, 12]]] as const) {
            const character = { level: 100, jutsuMastery: [{ jutsuId: jutsu.id, level }] };
            assert.equal(resolveCastFlavor(jutsu, 'Raiko', 'Mira', character), `Raiko weakens Mira by ${expected[0]}% and poisons them at ${expected[1]}%.`);
            assert.equal(jutsuDetailDescription(jutsu, level), `The user weakens the target by ${expected[0]}% and poisons them at ${expected[1]}%.`);
        }
        assert.equal(JSON.stringify(jutsu), original);
    });

    it('matches existing displayed effect values across ranks, caps, and ground zones', () => {
        for (const rank of [undefined, 'A Rank', 'S Rank'] as const) {
            for (const level of [0, 1, 10, 25, 49, 50]) {
                for (const ground of [false, true]) {
                    const jutsu = technique({ bloodlineRank: rank, target: ground ? 'EMPTY_GROUND' : 'OPPONENT', method: ground ? 'INSTANT_EFFECT' : 'SINGLE',
                        battleDescription: '%tag1 / %tag2', tags: [{ name: 'Increase Damage Taken', percent: 40 }, { name: 'Poison', percent: 20 }] });
                    const display = jutsuDisplayAtLevel(jutsu, level);
                    const expected = display.tags.map(tag => `${tag.percent}%`).join(' / ');
                    assert.equal(jutsuDetailDescription(jutsu, level), expected);
                    assert.equal(resolveCastFlavor(jutsu, 'A', 'B', { level: 100, jutsuMastery: [{ jutsuId: jutsu.id, level }] }), expected);
                }
            }
        }
    });

    it('respects the server combat mastery cap and defaults untrained casts to zero', () => {
        const jutsu = technique();
        assert.equal(resolveCastFlavor(jutsu, 'A', 'B', { level: 1, jutsuMastery: [{ jutsuId: jutsu.id, level: 50 }] }), 'A weakens B by 27% and poisons them at 8%.');
        assert.equal(resolveCastFlavor(jutsu, 'A', 'B', { level: 1 }), 'A weakens B by 25% and poisons them at 8%.');
    });

    it('keeps literal percentages and missing slots, replaces repeated slots, and includes the sign', () => {
        assert.equal(interpolateJutsuPercentages('25% %tag1 %tag2 %tag1 %tag10 %target', [30, undefined]), '25% 30% %tag2 30% %tag10 %target');
        assert.equal(interpolateJutsuPercentages('%tag1 %tag2', [0, NaN]), '0% %tag2');
    });
});
