import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { ITEM_CATALOG } from '../api/pvp/_item-catalog.js';
import { CRAFT_POINTS } from '../api/craft/_forge.js';
import { storesDonationRouting } from '../api/_village-stores.js';
import { NON_STORY_RELICS, RELIC_ROSTER } from './relics.js';
import { gearTierOf, isStepItemId } from './gear-steps.js';
import { GEAR_STEP_CRAFT_POINTS_BY_TIER, MATERIAL_CRAFT_POINTS, RELIC_CRAFT_POINTS_PER_TIER } from './village-stores-points.js';

describe('Village Stores material points (2026-10 item-use pass)', () => {
    it('keeps every hunt material and forge relic at its old value', () => {
        assert.deepEqual(MATERIAL_CRAFT_POINTS, {
            'hunt-torn-hide': 3, 'hunt-wild-feather': 3, 'hunt-small-fang': 3, 'hunt-cracked-horn': 3,
            'hunt-beast-meat': 5, 'hunt-frost-pelt': 8, 'hunt-shadow-claw': 8, 'hunt-wolf-fang': 10,
            'hunt-ash-scale': 15, 'hunt-ember-scale': 20, 'hunt-shadow-pelt': 25,
            'hunt-ancient-beast-core': 30, 'hunt-titan-bone': 30, 'hunt-legendary-material': 50,
            'weekly-boss-core': 150, 'dungeon-legendary-relic': 200, 'warforged-relic': 250, 'veil-of-the-hollow': 250,
        });
        for (const [id, points] of Object.entries(MATERIAL_CRAFT_POINTS)) assert.equal(CRAFT_POINTS[id], points, id);
    });

    it('gives every non-story relic 50 points per tier, and story relics none', () => {
        assert.equal(RELIC_CRAFT_POINTS_PER_TIER, 50);
        assert.equal(NON_STORY_RELICS.length, 16);
        for (const relic of NON_STORY_RELICS) {
            assert.equal(CRAFT_POINTS[relic.id], 50 * relic.tier, relic.id);
            assert.deepEqual(storesDonationRouting(relic.id, 1, CRAFT_POINTS), { store: 'materialPoints', amount: 50 * relic.tier, perItem: 50 * relic.tier });
        }
        for (const relic of RELIC_ROSTER.filter((r) => r.source.kind === 'story')) assert.equal(CRAFT_POINTS[relic.id], undefined, relic.id);
    });

    it('gives every gear step drop 50 / 75 / 100 points by tier, so an outgrown step has a use besides the NPC', () => {
        assert.deepEqual([...GEAR_STEP_CRAFT_POINTS_BY_TIER], [50, 75, 100]);
        const steps = Object.values(ITEM_CATALOG).filter((item) => isStepItemId(item.id));
        assert.equal(steps.length, 110, '25 + 15 + 25 weapon steps and 15 + 15 + 15 armor steps');
        const byTier = [0, 0, 0];
        for (const step of steps) {
            const tier = gearTierOf(step)!.tier;
            byTier[tier] += 1;
            assert.equal(CRAFT_POINTS[step.id], [50, 75, 100][tier], step.id);
        }
        assert.deepEqual(byTier, [40, 30, 40]);
        // Base (non-step) gear still has no stores value.
        assert.equal(CRAFT_POINTS['rustfang-kunai'], undefined);
    });
});
