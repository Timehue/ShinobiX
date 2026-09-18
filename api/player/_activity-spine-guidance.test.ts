import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildActivitySpine, type ActivitySpineInput } from './_activity-spine.js';
import { activitySaveFacts, enrichActivityFacts, type ActivityFactReader } from './_activity-spine-facts.js';
import { MASTERY_FOCUS_OPTIONS, type MasteryFocus } from '../../shared/activity-spine.js';
import { PUBLIC_CAPABILITY_IDS, type PublicCapabilities } from '../../shared/public-capabilities.js';
import { CHRONICLE_FIXED_FALLBACK_DECK } from '../../shared/chronicle-duel.js';
import { STORY_LEVELS } from '../story/_settle.js';
import { STORY_TOWER_MIN_LEVEL } from '../towers/_story-eligibility.js';
import { FLOOR_CATALOG } from '../towers/_floor-catalog.js';
import { ATTACKABLE_MIN_LEVEL } from '../_realtime/presence-gating.js';
import { LEGACY_MIN_LEVEL } from '../_legacy-defs.js';
import { PROFESSION_CHANGE_LEVEL } from '../../shared/profession-change.js';
import { applyForge } from '../craft/_forge.js';
import { showdownBusyIssue } from '../pet/_showdown-readiness.js';
import { makePlayerRankedAdmission, PET_RANKED_SEASON_GATE_KEY, PET_RANKED_SEASON_GATE_VERSION } from '../pet/_ranked-preparation.js';

const now = Date.UTC(2026, 8, 18);
const capabilities = Object.fromEntries(PUBLIC_CAPABILITY_IDS.map(id => [id, { state: 'available', reason: 'available' }])) as PublicCapabilities;
const pet = (id: string, extra = {}) => ({ id, name: id, level: 15, ...extra });
const character: Record<string, unknown> = { name: 'guide', village: 'Stormveil Village', level: 55, hp: 500, ryo: 2000, storyProgress: 4,
    profession: 'healer', professionRank: 3, professionXp: 700, pets: [pet('one')],
    tileCards: [...CHRONICLE_FIXED_FALLBACK_DECK], cardClashDeck: [...CHRONICLE_FIXED_FALLBACK_DECK], starterCardsClaimed: true,
    inventory: [], itemStacks: [], battleTowerBestFloor: 0, battleTowerClearedFloors: [] };
function input(focus: MasteryFocus, changes: Record<string, unknown> = {}, extra: Partial<ActivitySpineInput> = {}): ActivitySpineInput {
    const c = { ...character, ...changes };
    return { capabilities, now, level: Number(c.level), hospitalized: false, onboardingStep: 'done', unspentStats: 0,
        trainingIdle: true, jutsuTrainingIdle: true, hasJutsu: true, hasProfession: !!c.profession, profession: String(c.profession ?? ''), clanName: '', lastLoginRewardDate: '2026-09-18',
        focus, facts: activitySaveFacts(c, now), ...extra };
}
const first = (i: ActivitySpineInput) => buildActivitySpine(i).horizons.now[0]!;

test('each supported focus has a deterministic useful immediate action, with compact nonduplicate Today', () => {
    for (const { id } of MASTERY_FOCUS_OPTIONS) {
        const i = input(id);
        const spine = buildActivitySpine(i);
        assert.deepEqual(spine, buildActivitySpine(i));
        assert.equal(spine.horizons.now.length, 1);
        assert.ok(spine.horizons.today.length <= 3);
        assert.equal(spine.horizons['this-week'].length, 1);
        assert.equal(spine.horizons['long-term'].length, 1);
        assert.notEqual(first(i).id, 'mission-now');
        assert.equal(first(i).eligibility, 'eligible');
        assert.ok(!spine.horizons.today.some(a => a.screen === first(i).screen && a.section === first(i).section));
        assert.doesNotMatch(JSON.stringify(spine), /your chosen goal|wasting|guaranteed drop/i);
    }
});

test('story just below/at/above every published threshold agrees with the story authority', () => {
    STORY_LEVELS.forEach((requirement, completed) => {
        for (const level of [requirement - 1, requirement, requirement + 1]) {
            const result = first(input('village-chronicle', { level, storyProgress: completed }));
            assert.equal(result.screen, level < requirement ? 'training' : 'storyHall');
            if (level < requirement) assert.match(result.blocker!, new RegExp(`level ${requirement}`));
        }
    });
    assert.equal(first(input('village-chronicle', {}, { progressionHold: { level: 39, exam: 'chunin' } })).id, 'progression-hold-chunin');
    const complete = first(input('village-chronicle', { storyProgress: STORY_LEVELS.length }));
    assert.match(complete.title, /completed/);
    assert.equal(complete.runtimeModeId, undefined);
    const unknown = first(input('village-chronicle', { storyProgress: 'bad' }));
    assert.equal(unknown.id, 'story-review-now');
});

test('clan prerequisite remains usable and exhausted/unavailable operations lead to the hall', () => {
    assert.equal(first(input('clan-war')).id, 'clan-join-now');
    for (const boss of [{ active: false, killed: false, attemptsLeft: 5 }, { active: true, killed: true, attemptsLeft: 5 }, { active: true, killed: false, attemptsLeft: 0 }]) {
        const card = first(input('clan-war', {}, { clanName: 'test', clanBoss: boss }));
        assert.equal(card.id, 'clan-review-now');
        assert.equal(card.runtimeModeId, undefined);
    }
    const ready = first(input('clan-war', {}, { clanName: 'test', clanBoss: { active: true, killed: false, attemptsLeft: 1 } }));
    assert.equal(ready.section, 'clan-boss');
    assert.deepEqual(ready.requiredCapabilityIds, ['gameplay', 'gameplayMutations', 'clanBoss', 'clanBossParties']);
});

test('Tower advice uses published floors, canonical entry level/cost, and never invents floor best+1', () => {
    for (const level of [STORY_TOWER_MIN_LEVEL - 1, STORY_TOWER_MIN_LEVEL, STORY_TOWER_MIN_LEVEL + 1]) {
        assert.equal(first(input('towers-spire', { level })).screen, level < STORY_TOWER_MIN_LEVEL ? 'training' : 'battleTowers');
    }
    const complete = first(input('towers-spire', { battleTowerClearedFloors: FLOOR_CATALOG.map(f => f.id), battleTowerBestFloor: 999 }));
    assert.match(complete.title, /cleared/);
    assert.doesNotMatch(complete.title, /1000/);
    const noFee = first(input('towers-spire', { dailyBattleDate: '2026-09-18', dailyBattleFloors: 100, ryo: 0 }));
    assert.match(noFee.blocker!, /ryo/);
    assert.equal(first(input('companions', {}, { resume: { title: 'Resume Tower', screen: 'battleTowers', runtimeModeId: 'battle-towers' } })).id, 'resume-active-run');
});

test('an Endless Tower run resumes its own mode without turning the separate Tower review into a resume button', () => {
    const spine = buildActivitySpine(input('towers-spire', { endlessTowerRun: { wave: 3 } }, {
        resume: { title: 'Resume Endless Tower', screen: 'endlessTower', runtimeModeId: 'endless' },
    }));
    assert.equal(spine.horizons.now[0].screen, 'endlessTower');
    assert.equal(spine.horizons.now[0].runtimeModeId, 'endless');
    assert.equal(spine.horizons['this-week'][0].screen, 'battleTowers');
    assert.equal(spine.horizons['this-week'][0].cta, 'Review Towers');
});

test('Showdown readiness uses carried pets and the exact entry busy rule, without inventing defense locks', () => {
    const away = { expedition: { endsAt: now + 10_000 } };
    for (const pets of [[], [pet('one', away)], [pet('one', away), pet('two', { training: { endsAt: now + 5000 } })]]) {
        assert.equal(first(input('companions', { pets })).screen, 'pets');
    }
    const breeding = { petBreeding: { state: 'breeding', readyAt: now + 1000, parentIds: ['one'] } };
    assert.equal(first(input('companions', breeding)).screen, 'pets');
    assert.ok(showdownBusyIssue({ ...character, ...breeding }, [pet('one')], now));
    const ready = first(input('companions', { pets: [pet('one', away), pet('two')], petDefensePetIds: ['two'] }));
    assert.equal(ready.screen, 'petShowdown');
    assert.match(ready.why, /no XP, ranked progress, or items/);
    const overflow = Array.from({ length: 20 }, (_, n) => pet(`p${n}`, n < 19 ? away : {}));
    assert.equal(first(input('companions', { pets: overflow })).screen, 'pets');
    assert.equal(first(input('companions', { pets: null })).screen, 'pets');
});

test('correct-length illegal, unowned and unknown decks navigate to preparation without a starter re-claim', () => {
    for (const cardClashDeck of [Array(40).fill('tc-01'), Array(40).fill('not-a-card'), []]) {
        const card = first(input('chronicle-showdown', { cardClashDeck }));
        assert.equal(card.section, 'card-deck');
        assert.equal(card.eligibility, 'eligible');
        assert.equal(card.runtimeModeId, undefined);
    }
    assert.equal(first(input('chronicle-showdown', { tileCards: [] })).section, 'card-deck');
    assert.equal(first(input('chronicle-showdown')).section, 'card-play');
    assert.equal(first(input('chronicle-showdown', { starterCardsClaimed: false })).screen, 'worldMap');
});

test('supplies are craftable only when the real immutable forge decision accepts owned materials', () => {
    for (const inventory of [[], ['hunt-torn-hide'], ['hunt-shadow-pelt']]) {
        const c = { ...character, inventory };
        const before = structuredClone(c);
        assert.equal(activitySaveFacts(c, now).supplies?.craftable, !!applyForge(c, 'supply', 'item-smoke-bomb', 1));
        const today = buildActivitySpine(input('village-chronicle', { inventory })).horizons.today.find(a => a.id === 'prepare-supplies')!;
        assert.equal(today.section, 'crafter');
        assert.equal(/Prepare an optional/.test(today.title), inventory.includes('hunt-shadow-pelt'));
        assert.deepEqual(c, before);
    }
});

test('Legacy and profession preparation honor canonical floors and completion stays a review', () => {
    for (const [focus, minimum] of [['legacy', LEGACY_MIN_LEVEL], ['profession', PROFESSION_CHANGE_LEVEL], ['ranked-pvp', ATTACKABLE_MIN_LEVEL]] as const) {
        for (const level of [minimum - 1, minimum, minimum + 1]) {
            assert.equal(first(input(focus, { level, profession: '' })).screen === 'training', level < minimum);
        }
    }
    assert.equal(first(input('profession', { profession: '' })).screen, 'professionPicker');
    assert.match(first(input('profession', { professionRank: 10, professionXp: 1_000_000 })).why, /Check resource costs and cooldowns/);
    assert.match(first(input('legacy', { legacy: { legacyId: 'test', stage: 5 } })).title, /completed/);
    assert.equal(first(input('legacy', { legacy: { legacyId: 'test', stage: 2 } })).section, 'legacy');
});

test('revealed Legacy objective uses sealed baseline, bounded reads, and no bootstrap or acceptance', async () => {
    const c = { ...character, legacy: { legacyId: 'test', stage: 1 } };
    const reads: string[] = [];
    const reader = { get: async (key: string) => {
        reads.push(key);
        return key.startsWith('legacy:trial:') ? { legacyId: 'test', kind: 'awaken', baselines: { missionCompletions: 7 }, objectives: [{ stat: 'missionCompletions', delta: 5 }] } : { missionCompletions: 9 };
    } } as ActivityFactReader;
    const facts = await enrichActivityFacts(activitySaveFacts(c, now), c, 'guide', 'legacy', reader, now);
    const card = first(input('legacy', c, { facts }));
    assert.equal(card.screen, 'missions');
    assert.equal(card.progress, '2/5 mission completions');
    assert.ok(card.requiredCapabilityIds?.includes('legacy'));
    assert.deepEqual(reads, ['legacy:trial:guide', 'legacy:stats:guide']);
    reads.length = 0;
    await enrichActivityFacts(facts, c, 'guide', 'profession', reader, now);
    assert.equal(reads.length, 0);
});

test('unknown facts never claim a usable roster/deck or an available chapter', () => {
    for (const { id } of MASTERY_FOCUS_OPTIONS) {
        const card = first(input(id, {}, { facts: {} }));
        assert.ok(card.cta);
        assert.notEqual(card.id, 'story-now');
        assert.notEqual(card.screen, 'petShowdown');
        assert.notEqual(card.section, 'card-play');
    }
});

test('ranked readiness reads the current season authority without requiring an optional custom build', async () => {
    const previous = process.env.ENABLE_PLAYER_RANKED_V2;
    process.env.ENABLE_PLAYER_RANKED_V2 = '1';
    try {
        for (const state of ['open', 'closing', 'missing', 'mismatch']) {
            const reads: string[] = [];
            const reader = { get: async (key: string) => {
                reads.push(key);
                if (key !== PET_RANKED_SEASON_GATE_KEY) return { id: state === 'mismatch' ? 3 : 2 };
                if (state === 'missing') return null;
                return { version: PET_RANKED_SEASON_GATE_VERSION, state: state === 'closing' ? 'closing' : 'open', seasonId: 2, epoch: 1,
                    transitionId: state === 'closing' ? 'ranked-season-2-3' : null, nextSeasonId: state === 'closing' ? 3 : null,
                    changedAt: now, admissions: [], playerAdmissions: [] };
            } } as ActivityFactReader;
            const facts = await enrichActivityFacts(activitySaveFacts(character, now), character, 'guide', 'ranked-pvp', reader, now);
            assert.equal(facts.ranked.ready, state === 'open');
            assert.equal(first(input('ranked-pvp', {}, { facts })).screen, 'arenaDistrict');
            assert.deepEqual(reads, [PET_RANKED_SEASON_GATE_KEY, 'ranked:season:current']);
        }
    } finally {
        if (previous === undefined) delete process.env.ENABLE_PLAYER_RANKED_V2;
        else process.env.ENABLE_PLAYER_RANKED_V2 = previous;
    }
});

test('malformed readiness data stays conservative without making the whole panel unavailable', () => {
    const facts = activitySaveFacts({ ...character, village: 'unknown', petBreeding: { state: 'breeding', readyAt: now + 1000, parentIds: 7 },
        inventory: ['hunt-shadow-pelt'], itemStacks: [null] }, now);
    assert.equal(facts.story.nextEligible, false);
    assert.equal(facts.companions.usableCount, 0);
    assert.equal(facts.supplies?.craftable, false);
    assert.equal(first(input('village-chronicle', {}, { facts })).screen, 'logbook');
});

test('a retained ranked admission prevents another ready queue recommendation for either participant', async () => {
    const previous = process.env.ENABLE_PLAYER_RANKED_V2;
    process.env.ENABLE_PLAYER_RANKED_V2 = '1';
    try {
        const admission = makePlayerRankedAdmission({ matchId: 'player-ranked-f2345678-1234-4123-8123-1234567890ab', a: 'guide', b: 'rival',
            aLevel: 55, bLevel: 55, aRating: 1000, bRating: 1000, createdAt: now, seasonId: 2, seasonEpoch: 1 });
        const reader = { get: async (key: string) => key === PET_RANKED_SEASON_GATE_KEY
            ? { version: PET_RANKED_SEASON_GATE_VERSION, state: 'open', seasonId: 2, epoch: 1,
                transitionId: null, nextSeasonId: null, changedAt: now, admissions: [], playerAdmissions: [admission] }
            : { id: 2 } } as ActivityFactReader;
        for (const player of ['guide', 'rival', 'unrelated']) {
            const facts = await enrichActivityFacts(activitySaveFacts(character, now), character, player, 'ranked-pvp', reader, now);
            assert.equal(facts.ranked.ready, player === 'unrelated');
            if (player !== 'unrelated') {
                const card = first(input('ranked-pvp', {}, { facts }));
                assert.equal(card.cta, 'Review Ranked Queue');
                assert.match(card.blocker!, /current ranked admission/);
            }
        }
    } finally {
        if (previous === undefined) delete process.env.ENABLE_PLAYER_RANKED_V2;
        else process.env.ENABLE_PLAYER_RANKED_V2 = previous;
    }
});

test('malformed Legacy counters do not fabricate progress or a completed trial', async () => {
    const c = { ...character, legacy: { legacyId: 'test', stage: 1 } };
    for (const [baseline, current] of [[7, 'bad'], [Infinity, 9], [7, NaN]]) {
        const reader = { get: async (key: string) => key.startsWith('legacy:trial:')
            ? { legacyId: 'test', kind: 'awaken', baselines: { missionCompletions: baseline }, objectives: [{ stat: 'missionCompletions', delta: 5 }] }
            : { missionCompletions: current } } as ActivityFactReader;
        const facts = await enrichActivityFacts(activitySaveFacts(c, now), c, 'guide', 'legacy', reader, now);
        assert.equal(facts.legacy.objective, undefined);
        assert.equal(facts.legacy.trialReady, undefined);
        assert.equal(first(input('legacy', c, { facts })).section, 'legacy');
    }
});
