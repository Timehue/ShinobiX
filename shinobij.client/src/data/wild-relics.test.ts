/*
 * Wild relics — the open-world RNG chase drop for the `relic` slot.
 *
 * Three properties are load-bearing and easy to break by editing item data:
 *
 *  1. STAT BONUSES ONLY. Gear stats are folded in BEFORE the per-rank stat cap
 *     (perRankStatCap), so a relic speeds a player toward the shared ceiling and
 *     cannot lift a capped fighter past it. The percent passives
 *     (damagePercent / absorbPercent / reflectPercent / lifeStealPercent /
 *     shield) sit OUTSIDE that cap, so putting one on a very-low-chance RNG drop
 *     would let luck raise real PvP power — the exact thing the balanced-PvP
 *     pillar forbids. This is the guard that keeps the feature pillar-safe.
 *  2. They stay OUT of the shop (cost 0) — the world is the only source.
 *  3. Their artwork actually exists on disk. `image` is a bare public path with
 *     no build-time checking, so a typo or a missing file is invisible until a
 *     player opens their inventory and sees a broken icon.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { starterItems } from './starter-items';

const WILD_RELIC_ID = /^relic-/;
const wildRelics = starterItems.filter((item) => WILD_RELIC_ID.test(item.id));

// Bonus fields that are NOT clamped by the per-rank stat cap.
const CEILING_RAISING_FIELDS = [
    'damagePercent', 'absorbPercent', 'reflectPercent', 'lifeStealPercent', 'shield',
] as const;

describe('wild relics', () => {
    it('exist and all sit on the relic slot', () => {
        assert.equal(wildRelics.length, 8, 'the wild relic set is 8 items');
        for (const relic of wildRelics) {
            assert.equal(relic.slot, 'relic', `${relic.id} must occupy the relic slot`);
        }
    });

    it('grant stat bonuses ONLY — never a ceiling-raising passive', () => {
        for (const relic of wildRelics) {
            const bonuses = (relic.bonuses ?? {}) as Record<string, number>;
            for (const field of CEILING_RAISING_FIELDS) {
                assert.equal(
                    bonuses[field], undefined,
                    `${relic.id} carries ${field}, which is NOT under the per-rank stat cap — `
                    + 'an RNG drop must not be able to raise a player\'s PvP ceiling',
                );
            }
            assert.ok(Object.keys(bonuses).length > 0, `${relic.id} should grant something`);
        }
    });

    it('are unbuyable — the world is the only source', () => {
        for (const relic of wildRelics) {
            assert.equal(relic.cost, 0, `${relic.id} must not be purchasable`);
        }
    });

    // Widened from the 8 wild relics to EVERY relic: the slot showed painted art
    // for chest drops and grey name-initials for story keepsakes, so earning one
    // looked worse than finding one. All 15 now ship art.
    it('every relic-slot item ships real artwork that exists on disk', () => {
        const allRelics = starterItems.filter((item) => item.slot === 'relic');
        assert.ok(allRelics.length >= 8, 'sanity: the relic slot is populated');
        for (const relic of allRelics) {
            assert.ok(relic.image, `${relic.id} has no image`);
            const rel = String(relic.image).replace(/^\//, '');
            const onDisk = join(process.cwd(), 'shinobij.client', 'public', rel);
            const fromClient = join(process.cwd(), 'public', rel);
            assert.ok(
                existsSync(onDisk) || existsSync(fromClient),
                `${relic.id} points at ${relic.image}, which is not on disk`,
            );
        }
    });

    it('out-scale the free story/shop relics, which are the floor of the pool', () => {
        const total = (item: { bonuses?: Record<string, number> }) =>
            Object.values(item.bonuses ?? {}).reduce((sum, value) => sum + Number(value || 0), 0);
        const freeRelics = starterItems.filter((item) => item.slot === 'relic' && !WILD_RELIC_ID.test(item.id));
        const weakestWild = Math.min(...wildRelics.map(total));
        const strongestFree = Math.max(...freeRelics.map(total), 0);
        assert.ok(
            weakestWild > strongestFree,
            `the weakest wild relic (${weakestWild}) must beat the best free one (${strongestFree})`,
        );
    });
});
