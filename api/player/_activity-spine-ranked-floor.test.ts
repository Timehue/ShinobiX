import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { PUBLIC_CAPABILITY_IDS, type PublicCapabilities } from '../../shared/public-capabilities.js';
import { ATTACKABLE_MIN_LEVEL } from '../_realtime/presence-gating.js';
import { buildActivitySpine, type ActivitySpineInput } from './_activity-spine.js';

/*
 * F19 — the ranked guidance said "blocked below 15" while the ranked queue
 * (api/pvp/ranked-queue.ts) admits at the attackable floor, level 10. The
 * eligibility FACT now comes from the shared constant; the authored blocker
 * copy is deliberately untouched (behavior-only scope) and recorded as a
 * deferred UI dependency in docs/RPG_BEHAVIOR_HANDOFF_TRACKING.md.
 */

const capabilities = Object.fromEntries(PUBLIC_CAPABILITY_IDS.map((id) => [id, { state: 'available', reason: 'available' }])) as PublicCapabilities;

function input(level: number): ActivitySpineInput {
    return {
        capabilities,
        now: Date.UTC(2026, 8, 6), level, hospitalized: false, onboardingStep: 'done', unspentStats: 0,
        trainingIdle: true, jutsuTrainingIdle: true, hasJutsu: true, hasProfession: true, profession: 'healer', clanName: '', lastLoginRewardDate: '2026-09-05',
        focus: 'ranked-pvp',
        facts: {
            story: { completed: 1, total: 9, nextLevel: 20, nextEligible: false },
            ranked: { rating: 1000, wins: 0 },
            towers: { bestFloor: 0, bestWave: 0, spireTier: 0, activeRun: false },
            companions: { count: 0, activeName: '', activeLevel: 0, expeditionActive: false, ladderRating: 1000 },
            chronicle: { deckCards: 0, collectionCards: 0, wins: 0 },
            legacy: { accepted: false, stage: 0 },
            profession: { selected: true, label: 'Healer', rank: 1, xp: 0 },
            prestige: { level, specialJoninPassed: false, pvpKills: 0 },
        },
        clanBoss: null,
    } as unknown as ActivitySpineInput;
}

function rankedEligibility(level: number): string | undefined {
    const spine = buildActivitySpine(input(level));
    const week = spine.horizons['this-week'].find((item) => item.id === 'focus-ranked-week');
    assert.ok(week, `level ${level}: the ranked focus card must be present`);
    return week.eligibility;
}

describe('ranked guidance eligibility matches the ranked queue floor', () => {
    it('the queue floor is the level-10 attackable floor, not the Academy threshold', () => {
        assert.equal(ATTACKABLE_MIN_LEVEL, 10);
    });

    it('levels 9 / 10 / 14 / 15 read the same answer the queue gives', () => {
        assert.equal(rankedEligibility(9), 'blocked');
        assert.equal(rankedEligibility(10), 'eligible', 'the queue admits level 10; guidance must agree');
        assert.equal(rankedEligibility(14), 'eligible', 'levels 10–14 were wrongly told Ranked was blocked');
        assert.equal(rankedEligibility(15), 'eligible');
    });

    it('a blocked level still carries its (unchanged, authored) blocker text', () => {
        const spine = buildActivitySpine(input(9));
        const week = spine.horizons['this-week'].find((item) => item.id === 'focus-ranked-week');
        assert.ok(week?.blocker, 'blocked guidance keeps a blocker');
    });
});
