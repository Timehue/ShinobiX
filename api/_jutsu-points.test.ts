import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    pointBudgetForRank, tagPointValue, jutsuPoints, bloodlinePoints, enforceBloodlineBudget,
} from './_jutsu-points.js';

describe('_jutsu-points — point math', () => {
    it('pointBudgetForRank: S 11 / A 10 / B 7 / none 7', () => {
        assert.equal(pointBudgetForRank('S Rank'), 11);
        assert.equal(pointBudgetForRank('A Rank'), 10);
        assert.equal(pointBudgetForRank('B Rank'), 7);
        assert.equal(pointBudgetForRank(null), 7);
        assert.equal(pointBudgetForRank(undefined), 7);
    });

    it('tagPointValue: control + capped-amp + Wound tiers', () => {
        assert.equal(tagPointValue({ name: 'Copy' }, 'A Rank'), 3);
        assert.equal(tagPointValue({ name: 'Mirror' }, 'A Rank'), 3);
        assert.equal(tagPointValue({ name: 'Stun' }, 'A Rank'), 2);
        assert.equal(tagPointValue({ name: 'Bloodline Seal' }, 'A Rank'), 2);
        // capped amp: at/above the rank cap costs more than below it
        assert.equal(tagPointValue({ name: 'Increase Damage Given', percent: 35 }, 'A Rank'), 0.75);
        assert.equal(tagPointValue({ name: 'Increase Damage Given', percent: 30 }, 'A Rank'), 0.25);
        assert.equal(tagPointValue({ name: 'Increase Damage Given', percent: 40 }, 'S Rank'), 0.75);
        assert.equal(tagPointValue({ name: 'Increase Damage Given', percent: 35 }, 'S Rank'), 0.25);
        // Wound tiers
        assert.equal(tagPointValue({ name: 'Wound', percent: 35 }, 'S Rank'), 1);
        assert.equal(tagPointValue({ name: 'Wound', percent: 30 }, 'A Rank'), 0.5);
        assert.equal(tagPointValue({ name: 'Wound', percent: 25 }, 'B Rank'), 0.25);
    });

    it('canonicalizes aliases (Seal -> Bloodline Seal = 2)', () => {
        assert.equal(tagPointValue({ name: 'Seal' }, 'A Rank'), 2);
    });

    it('jutsuPoints adds structural costs (40-AP utility, nuke, low cooldown)', () => {
        // 40-AP utility (+1) with one capped amp below cap (0.25), cooldown 7 (no +0.5)
        assert.equal(jutsuPoints({ ap: 40, range: 4, effectPower: 0, cooldown: 7, tags: [{ name: 'Increase Damage Given', percent: 30 }] }, 'A Rank'), 1.25);
        // 60-AP nuke (effectPower 50 → +1), cooldown 1 (+0.5), no tags
        assert.equal(jutsuPoints({ ap: 60, range: 4, effectPower: 50, cooldown: 1, tags: [] }, 'A Rank'), 1.5);
        // fixed-effect (Stun) jutsu does NOT get the nuke point even at EP 50
        assert.equal(jutsuPoints({ ap: 60, range: 4, effectPower: 50, cooldown: 7, tags: [{ name: 'Stun' }] }, 'A Rank'), 2);
    });

    it('honest within-budget bloodline is unchanged (deep-equal, no-op)', () => {
        const jutsus = [
            { ap: 60, range: 4, effectPower: 36, cooldown: 7, tags: [{ name: 'Wound', percent: 30 }] },
            { ap: 60, range: 4, effectPower: 36, cooldown: 7, tags: [{ name: 'Poison' }] },
        ];
        assert.ok(bloodlinePoints(jutsus, 'B Rank') <= pointBudgetForRank('B Rank'));
        assert.deepEqual(enforceBloodlineBudget(jutsus, 'B Rank'), jutsus);
    });

    it('RED-TEAM: forged over-budget bloodline is clamped down (never rejected, jutsu never dropped)', () => {
        // 5 jutsu × {Copy 3, Mirror 3, Stun 2} = 40 pts vs B-rank budget 7.
        const jutsus = Array.from({ length: 5 }, () => ({
            ap: 60, range: 4, effectPower: 36, cooldown: 7,
            tags: [{ name: 'Copy' }, { name: 'Mirror' }, { name: 'Stun' }],
        }));
        const out = enforceBloodlineBudget(jutsus, 'B Rank');
        assert.equal(out.length, 5, 'jutsu are never dropped — only tags are stripped');
        assert.ok(bloodlinePoints(out, 'B Rank') <= pointBudgetForRank('B Rank'), 'clamped within budget');
    });

    it('strip is deterministic (same input → same output)', () => {
        const mk = () => Array.from({ length: 5 }, () => ({
            ap: 60, range: 4, effectPower: 36, cooldown: 7,
            tags: [{ name: 'Copy' }, { name: 'Stun' }, { name: 'Wound', percent: 35 }],
        }));
        assert.deepEqual(enforceBloodlineBudget(mk(), 'A Rank'), enforceBloodlineBudget(mk(), 'A Rank'));
    });

    it('does not mutate the input', () => {
        const jutsus = [{ ap: 60, range: 4, effectPower: 36, cooldown: 7, tags: [{ name: 'Copy' }, { name: 'Mirror' }, { name: 'Stun' }] }];
        const before = JSON.stringify(jutsus);
        enforceBloodlineBudget(jutsus, 'B Rank');
        assert.equal(JSON.stringify(jutsus), before);
    });

    it('empty / non-array input is a no-op', () => {
        assert.deepEqual(enforceBloodlineBudget([], 'A Rank'), []);
        assert.equal(enforceBloodlineBudget(undefined as never, 'A Rank'), undefined);
    });
});
