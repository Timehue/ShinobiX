import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { ACTIVITY_HORIZONS } from '../../shared/activity-spine.js';
import { buildActivitySpine, type ActivitySpineInput } from './_activity-spine.js';

const input: ActivitySpineInput = {
    now: Date.UTC(2026, 7, 5), level: 40, hospitalized: false, onboardingStep: 'done', unspentStats: 0,
    trainingIdle: true, jutsuTrainingIdle: true, hasJutsu: true, hasProfession: true, clanName: 'Testers', lastLoginRewardDate: '2026-08-04',
    clanBoss: { active: true, killed: false, attemptsLeft: 3, pressure: 72, sectorName: 'Emberspine Ridge' },
};

describe('server activity spine', () => {
    it('always returns the four explicit planning horizons', () => {
        const spine = buildActivitySpine(input);
        assert.deepEqual(Object.keys(spine.horizons), [...ACTIVITY_HORIZONS]);
        for (const horizon of ACTIVITY_HORIZONS) assert.ok(spine.horizons[horizon].length > 0);
    });

    it('prioritizes recovery and reconnects an active operation after refresh', () => {
        assert.equal(buildActivitySpine({ ...input, hospitalized: true }).horizons.now[0]?.id, 'recover-hospital');
        assert.equal(buildActivitySpine({ ...input, clanBoss: { ...input.clanBoss!, partyStatus: 'active' } }).horizons.now[0]?.id, 'resume-clan-operation');
    });

    it('covers early, mid, late, cap, and returning-player states without hiding blockers', () => {
        for (const level of [1, 15, 30, 50, 80, 100]) {
            const spine = buildActivitySpine({ ...input, level, hasProfession: level >= 13 });
            assert.ok(spine.horizons['long-term'][0]?.title);
        }
        const returning = buildActivitySpine({ ...input, lastLoginRewardDate: '2026-07-01' });
        assert.equal(returning.returningPlayer, true);
        const noClan = buildActivitySpine({ ...input, clanName: '' });
        assert.equal(noClan.horizons['this-week'][0]?.eligibility, 'blocked');
        assert.match(noClan.horizons['this-week'][0]?.blocker ?? '', /Join a clan/);
    });
});
