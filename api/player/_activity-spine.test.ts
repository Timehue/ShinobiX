import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { ACTIVITY_HORIZONS, MASTERY_FOCUS_OPTIONS } from '../../shared/activity-spine.js';
import { PUBLIC_CAPABILITY_IDS, type PublicCapabilities, type PublicCapabilityId } from '../../shared/public-capabilities.js';
import { buildActivitySpine, type ActivitySpineInput } from './_activity-spine.js';

function capabilitiesWith(
    overrides: Partial<Record<PublicCapabilityId, PublicCapabilities[PublicCapabilityId]>> = {},
): PublicCapabilities {
    return Object.fromEntries(PUBLIC_CAPABILITY_IDS.map((id) => [
        id,
        overrides[id] ?? { state: 'available', reason: 'available' },
    ])) as PublicCapabilities;
}

const input: ActivitySpineInput = {
    capabilities: capabilitiesWith(),
    now: Date.UTC(2026, 7, 5), level: 40, hospitalized: false, onboardingStep: 'done', unspentStats: 0,
    trainingIdle: true, jutsuTrainingIdle: true, hasJutsu: true, hasProfession: true, profession: 'healer', clanName: 'Testers', lastLoginRewardDate: '2026-08-04',
    focus: 'auto',
    facts: {
        story: { completed: 3, total: 9, nextLevel: 35, nextEligible: true },
        ranked: { rating: 1240, wins: 8 },
        towers: { bestFloor: 6, bestWave: 14, spireTier: 1, activeRun: false },
        companions: { count: 2, activeName: 'Kumo', activeLevel: 18, expeditionActive: false, ladderRating: 1080 },
        chronicle: { deckCards: 40, collectionCards: 72, wins: 6 },
        legacy: { accepted: false, stage: 0 },
        profession: { selected: true, label: 'Healer', rank: 4, xp: 820 },
        prestige: { level: 40, specialJoninPassed: false, pvpKills: 8 },
    },
    clanBoss: { active: true, killed: false, attemptsLeft: 3, pressure: 72, sectorName: 'Emberspine Ridge' },
};

describe('server activity spine', () => {
    it('always returns four compact horizons with one focus card in each long horizon', () => {
        const spine = buildActivitySpine(input);
        assert.deepEqual(Object.keys(spine.horizons), [...ACTIVITY_HORIZONS]);
        assert.equal(spine.horizons.now.length, 1);
        assert.equal(spine.horizons.today.length, 3);
        assert.equal(spine.horizons['this-week'].length, 1);
        assert.equal(spine.horizons['long-term'].length, 1);
        assert.equal(spine.selectedFocus, 'auto');
        assert.equal(spine.resolvedFocus, 'clan-war');
    });

    it('projects a non-empty exact capability list onto every response item', () => {
        const spine = buildActivitySpine(input);
        for (const horizon of ACTIVITY_HORIZONS) {
            for (const activity of spine.horizons[horizon]) {
                assert.ok(activity.requiredCapabilityIds?.length);
                assert.equal(activity.requiredCapabilityIds?.[0], 'gameplay');
                assert.ok(activity.requiredCapabilityIds?.every((id) => PUBLIC_CAPABILITY_IDS.includes(id)));
            }
        }
        assert.deepEqual(spine.horizons['this-week'][0]?.requiredCapabilityIds, [
            'gameplay', 'gameplayMutations', 'clanBoss',
        ]);
    });

    it('keeps recovery, Academy, reconnect, unspent growth, and real exam holds ahead of focus', () => {
        assert.equal(buildActivitySpine({ ...input, hospitalized: true }).horizons.now[0]?.id, 'recover-hospital');
        assert.equal(buildActivitySpine({ ...input, onboardingStep: 'training' }).horizons.now[0]?.id, 'continue-academy');
        assert.equal(buildActivitySpine({ ...input, clanBoss: { ...input.clanBoss!, partyStatus: 'active' } }).horizons.now[0]?.id, 'resume-clan-operation');
        assert.equal(buildActivitySpine({ ...input, resume: { title: 'Resume battle', screen: 'battleTowers', runtimeModeId: 'battle-towers' } }).horizons.now[0]?.id, 'resume-active-run');
        assert.equal(buildActivitySpine({ ...input, unspentStats: 4 }).horizons.now[0]?.id, 'spend-growth');
        assert.equal(buildActivitySpine({ ...input, progressionHold: { exam: 'chunin', level: 39 } }).horizons.now[0]?.id, 'progression-hold-chunin');
    });

    it('covers new, early, mid, late, cap, and returning cohorts deterministically', () => {
        for (const level of [1, 15, 35, 55, 85, 100]) {
            const cohort = { ...input, level, hasProfession: level >= 13, clanBoss: { ...input.clanBoss!, active: false } };
            assert.deepEqual(buildActivitySpine(cohort), buildActivitySpine(cohort));
            assert.ok(buildActivitySpine(cohort).horizons['long-term'][0]?.title);
        }
        assert.equal(buildActivitySpine({ ...input, lastLoginRewardDate: '2026-07-01' }).returningPlayer, true);
    });

    it('returns bounded actionable cards for every mastery focus', () => {
        for (const option of MASTERY_FOCUS_OPTIONS.filter((option) => option.id !== 'auto')) {
            const spine = buildActivitySpine({ ...input, focus: option.id });
            assert.equal(spine.selectedFocus, option.id);
            assert.equal(spine.resolvedFocus, option.id);
            for (const activity of [...spine.horizons['this-week'], ...spine.horizons['long-term']]) {
                assert.ok(activity.title && activity.why && activity.commitment && activity.progress && activity.screen && activity.cta);
                if (activity.eligibility === 'blocked') assert.ok(activity.blocker);
            }
        }
    });

    it('uses accurate blockers and gives completed focuses a review destination', () => {
        const soloClan = buildActivitySpine({ ...input, focus: 'clan-war', clanName: '' });
        assert.equal(soloClan.horizons['this-week'][0]?.eligibility, 'blocked');
        assert.match(soloClan.horizons['this-week'][0]?.blocker ?? '', /Join or found a clan/);

        const blockedStory = buildActivitySpine({
            ...input,
            focus: 'village-chronicle',
            facts: { ...input.facts, story: { completed: 4, total: 9, nextLevel: 50, nextEligible: false } },
        });
        assert.match(blockedStory.horizons['this-week'][0]?.blocker ?? '', /level 50/);

        const completedStory = buildActivitySpine({
            ...input,
            focus: 'village-chronicle',
            facts: { ...input.facts, story: { completed: 9, total: 9, nextLevel: null, nextEligible: true } },
        });
        for (const card of [completedStory.horizons['this-week'][0], completedStory.horizons['long-term'][0]]) {
            assert.equal(card?.eligibility, 'complete');
            assert.equal(card?.screen, 'storyHall');
            assert.match(card?.cta ?? '', /Review|View/);
        }
    });

    it('points the companion focus at Pet Showdown once a companion is home', () => {
        const roster = { count: 2, activeName: 'Kumo', activeLevel: 18, expeditionActive: false, ladderRating: 1080 };
        const companions = (over: Partial<typeof roster>) => buildActivitySpine({
            ...input,
            focus: 'companions',
            facts: { ...input.facts, companions: { ...roster, ...over } },
        }).horizons['this-week'][0];

        const ready = companions({});
        assert.equal(ready?.screen, 'petShowdown');
        assert.equal(ready?.eligibility, 'eligible');

        const noRoster = companions({ count: 0, activeName: '', activeLevel: 0 });
        assert.equal(noRoster?.screen, 'pets');
        assert.match(noRoster?.blocker ?? '', /Pet Yard/);

        const soleCompanionAway = companions({ count: 1, expeditionActive: true });
        assert.equal(soleCompanionAway?.eligibility, 'blocked');
        assert.match(soleCompanionAway?.blocker ?? '', /expedition/);

        // A second companion covers the absence, so the mode stays open.
        assert.equal(companions({ expeditionActive: true })?.screen, 'petShowdown');
    });

    it('keeps story recommendations spoiler-safe and unknown focus values harmless', () => {
        const story = buildActivitySpine({ ...input, focus: 'village-chronicle' });
        const copy = JSON.stringify([story.horizons['this-week'], story.horizons['long-term']]);
        assert.doesNotMatch(copy, /villain|future boss|twist|outcome/i);
        const unknown = buildActivitySpine({ ...input, focus: 'retired-focus' });
        assert.equal(unknown.selectedFocus, 'auto');
    });

    it('shows optional Special Jonin prestige only for relevant endgame focus', () => {
        const endgameFacts = { ...input.facts, prestige: { level: 85, specialJoninPassed: false, pvpKills: 42 } };
        const ranked = buildActivitySpine({ ...input, level: 85, focus: 'ranked-pvp', facts: endgameFacts });
        assert.equal(ranked.horizons['long-term'][0]?.id, 'focus-special-jonin-prestige');
        assert.match(ranked.horizons['long-term'][0]?.why ?? '', /does not block leveling, stats, jutsu, or content/i);
        const story = buildActivitySpine({ ...input, level: 85, focus: 'village-chronicle', facts: endgameFacts });
        assert.notEqual(story.horizons['long-term'][0]?.id, 'focus-special-jonin-prestige');

        const automatic = buildActivitySpine({
            ...input,
            level: 85,
            focus: 'auto',
            hasProfession: true,
            clanBoss: { active: false, killed: false, attemptsLeft: 5 },
            facts: {
                story: { completed: 9, total: 9, nextLevel: null, nextEligible: true },
                ranked: { rating: 1300, wins: 25 },
                towers: { bestFloor: 50, bestWave: 100, spireTier: 10, activeRun: false },
                companions: { count: 1, activeName: 'Kumo', activeLevel: 100, expeditionActive: false, ladderRating: 1200 },
                chronicle: { deckCards: 40, collectionCards: 80, wins: 25 },
                legacy: { accepted: true, stage: 5 },
                profession: { selected: true, label: 'healer', rank: 8, xp: 500 },
                prestige: { level: 85, specialJoninPassed: false, pvpKills: 44 },
            },
        });
        assert.equal(automatic.resolvedFocus, 'ranked-pvp');
        assert.equal(automatic.horizons['long-term'][0]?.id, 'focus-special-jonin-prestige');
    });

    it('skips disabled Clan Boss auto-focus and falls selected Boss focus back to generic Clan', () => {
        const capabilities = capabilitiesWith({
            clanBoss: { state: 'temporarily-unavailable', reason: 'temporarily-disabled' },
            clanBossParties: { state: 'temporarily-unavailable', reason: 'temporarily-disabled' },
        });
        const automatic = buildActivitySpine({ ...input, capabilities, focus: 'auto' });
        assert.notEqual(automatic.resolvedFocus, 'clan-war');
        assert.doesNotMatch(JSON.stringify(automatic.horizons), /focus-clan-week|Clan Boss threat|Open Clan Operations/);

        const selected = buildActivitySpine({ ...input, capabilities, focus: 'clan-war' });
        assert.equal(selected.resolvedFocus, 'clan-war');
        assert.equal(selected.horizons['this-week'][0]?.id, 'focus-clan-generic-week');
        assert.equal(selected.horizons['this-week'][0]?.eligibility, 'eligible');
        assert.equal(selected.horizons['this-week'][0]?.capabilityId, undefined);
        assert.equal(selected.horizons['this-week'][0]?.runtimeModeId, undefined);
    });

    it('falls a selected disabled Legacy back to an available focus', () => {
        const spine = buildActivitySpine({
            ...input,
            focus: 'legacy',
            capabilities: capabilitiesWith({ legacy: { state: 'temporarily-unavailable', reason: 'configuration-unavailable' } }),
        });
        assert.equal(spine.selectedFocus, 'legacy');
        assert.notEqual(spine.resolvedFocus, 'legacy');
        assert.doesNotMatch(JSON.stringify(spine.horizons), /focus-legacy-|Hall of Legends|Legacy Journey/);
    });

    it('keeps active disabled party operations visible as blocked recovery-only state', () => {
        const capabilities = capabilitiesWith({
            clanBossParties: { state: 'temporarily-unavailable', reason: 'temporarily-disabled' },
        });
        const spine = buildActivitySpine({
            ...input,
            capabilities,
            clanBoss: { ...input.clanBoss!, partyStatus: 'active' },
        });
        const recovery = spine.horizons.now[0];
        assert.equal(recovery?.id, 'resume-clan-operation');
        assert.equal(recovery?.runtimeModeId, 'clan-boss');
        assert.equal(recovery?.capabilityId, 'clanBossParties');
        assert.equal(recovery?.eligibility, 'blocked');
        assert.equal(recovery?.recoveryOnly, true);
        assert.match(recovery?.blocker ?? '', /temporarily unavailable/);
    });

    it('keeps a disabled resumable mode visible but prevents new actions', () => {
        const capabilities = capabilitiesWith({
            gameplayMutations: { state: 'actions-paused', reason: 'operations-paused' },
        });
        const spine = buildActivitySpine({
            ...input,
            capabilities,
            resume: { title: 'Resume battle', screen: 'battleTowers', runtimeModeId: 'battle-towers' },
        });
        const recovery = spine.horizons.now[0];
        assert.equal(recovery?.id, 'resume-active-run');
        assert.equal(recovery?.runtimeModeId, 'battle-towers');
        assert.equal(recovery?.eligibility, 'blocked');
        assert.equal(recovery?.recoveryOnly, true);
        assert.match(recovery?.blocker ?? '', /actions are temporarily paused/i);
    });

    it('removes paused runtime admissions from ordinary recommendations', () => {
        const spine = buildActivitySpine({
            ...input,
            capabilities: capabilitiesWith({
                gameplayMutations: { state: 'actions-paused', reason: 'operations-paused' },
            }),
            focus: 'ranked-pvp',
            clanBoss: { ...input.clanBoss!, active: false },
        });
        assert.equal(spine.horizons.now[0]?.id, 'service-review-now');
        assert.equal(spine.horizons.now[0]?.eligibility, 'eligible');
        assert.equal(spine.horizons.now[0]?.requiresMutation, false);
        assert.equal(spine.horizons.today[0]?.id, 'service-review-today');
        assert.equal(spine.horizons.today[0]?.eligibility, 'eligible');
        assert.equal(spine.horizons.today[0]?.requiresMutation, false);
        assert.equal(spine.horizons.today.length, 1);
        assert.equal(spine.horizons['this-week'][0]?.runtimeModeId, undefined);
        assert.equal(spine.horizons['long-term'][0]?.runtimeModeId, undefined);
        assert.equal(spine.horizons['this-week'][0]?.id, 'focus-service-review-week');
        assert.equal(spine.horizons['long-term'][0]?.id, 'focus-service-review-long');
        assert.equal(spine.horizons['this-week'][0]?.eligibility, 'eligible');
        assert.equal(spine.horizons['long-term'][0]?.eligibility, 'eligible');
        assert.equal(spine.horizons['this-week'][0]?.requiresMutation, false);
        assert.equal(spine.horizons['long-term'][0]?.requiresMutation, false);
    });

    it('does not misrepresent local review cards as server-readable during maintenance', () => {
        const spine = buildActivitySpine({
            ...input,
            capabilities: capabilitiesWith({
                gameplay: { state: 'temporarily-unavailable', reason: 'maintenance' },
                gameplayMutations: { state: 'temporarily-unavailable', reason: 'maintenance' },
            }),
            focus: 'ranked-pvp',
        });
        for (const horizon of ['now', 'today', 'this-week', 'long-term'] as const) {
            assert.equal(spine.horizons[horizon][0]?.eligibility, 'blocked');
            assert.match(spine.horizons[horizon][0]?.blocker ?? '', /maintenance/i);
        }
    });

    it('does not confuse generic Companion activity with breeding admission', () => {
        const spine = buildActivitySpine({
            ...input,
            focus: 'companions',
            capabilities: capabilitiesWith({ petBreedingStarts: { state: 'temporarily-unavailable', reason: 'temporarily-disabled' } }),
        });
        assert.equal(spine.resolvedFocus, 'companions');
        assert.equal(spine.horizons['this-week'][0]?.runtimeModeId, 'pet-showdown-practice');
        assert.equal(spine.horizons['this-week'][0]?.eligibility, 'eligible');
        assert.equal(spine.horizons['long-term'][0]?.runtimeModeId, 'pet-ladder-showdown');
    });
});
