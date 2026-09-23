import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { PUBLIC_CAPABILITY_IDS, type PublicCapabilities } from '../../shared/public-capabilities.js';
import { RANKED_MIN_LEVEL } from '../../shared/ranked-eligibility.js';
import { buildActivitySpine, type ActivitySpineInput } from './_activity-spine.js';

/*
 * Ranked guidance and the ranked queue share a floor of level 11.
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
            towers: { bestFloor: 0, bestWave: 0, spireTier: 0 },
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
    it('the queue floor is level 11', () => {
        assert.equal(RANKED_MIN_LEVEL, 11);
    });

    it('levels 9 and 10 get preparation guidance; 11 and above can review the queue', () => {
        assert.equal(rankedEligibility(9), 'eligible', 'review navigation remains usable below the queue floor');
        assert.equal(buildActivitySpine(input(9)).horizons.now[0]?.screen, 'training');
        assert.equal(buildActivitySpine(input(10)).horizons.now[0]?.screen, 'training');
        assert.equal(rankedEligibility(10), 'eligible', 'the Arena review link remains usable');
        assert.equal(buildActivitySpine(input(11)).horizons.now[0]?.screen, 'arenaDistrict');
        assert.equal(rankedEligibility(11), 'eligible');
    });

    it('a blocked level names the threshold the queue actually enforces', () => {
        const spine = buildActivitySpine(input(9));
        const week = spine.horizons['this-week'].find((item) => item.id === 'focus-ranked-week');
        assert.ok(week?.blocker, 'blocked guidance keeps a blocker');
        assert.match(week.blocker, new RegExp(`level ${RANKED_MIN_LEVEL}\\b`));
        assert.doesNotMatch(week.blocker, /level 15/, 'the old Academy number must not survive');
    });
});
