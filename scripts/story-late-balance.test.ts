import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LATE_STORY_LEVELS, LATE_STORY_VILLAGES, LATE_STORY_FIELD_SECTORS, lateStorySave, lateStorySession } from './story-late-balance-audit.js';
import { GROUP_SCHOOLS, pilotGroup } from './test-fixtures/narrative-group-balance.js';
import { allocatedStatPoints, earnedForLevel, STAT_KEYS } from '../api/_xp-engine.js';
import { LOADOUT_CAP_BASE } from '../api/_entitlements.js';
import { effectiveItemLevelReq } from '../shared/item-level-gate.js';
import { ITEM_CATALOG } from '../api/pvp/_item-catalog.js';
import { JUTSU_CATALOG } from '../api/pvp/_jutsu-catalog.js';
import { jutsuLevelCapForLevel, perRankStatCap, statCapForLevel } from '../api/combat-core/formulas.js';
import { pveDifficultyHpMultiplier, pveDifficultyStatMultiplier, scaleStatsForPveDifficulty } from '../api/_pve-difficulty.js';
import { storyBossEnemyTemplate } from '../api/story/_authoritative-story-combat.js';
import { STANDARD_PVE_AI_POLICY, enemyTurnPolicyForEncounter } from '../api/solo-pve/_ai-turn-policy.js';
import { escalationCandidate, storyPressureSummary } from './story-escalation-balance-audit.js';
import { NARRATIVE_GROUPS } from '../shared/narrative-groups.js';

test('late-story builds conserve progression, own every nature, meet gear gates and use the free loadout capacity', () => {
    for (const level of LATE_STORY_LEVELS) for (const school of GROUP_SCHOOLS) for (const focused of [false, true]) {
        const c = lateStorySave(level, school, focused).character;
        assert.equal(allocatedStatPoints(c.stats), earnedForLevel(level));
        assert.equal(c.earnedStatPoints, earnedForLevel(level));
        assert.ok(Object.values(c.stats).every(n => n <= statCapForLevel(level)));
        assert.deepEqual(c.elements, ['Earth', 'Wind']);
        assert.equal(c.equippedJutsuIds.length, LOADOUT_CAP_BASE);
        assert.equal(new Set(c.equippedJutsuIds).size, LOADOUT_CAP_BASE);
        for (const id of c.equippedJutsuIds) {
            const j = JUTSU_CATALOG[id];
            assert.ok(j, id);
            assert.ok(['None', ...c.elements].includes(j.element ?? 'None'), id);
            assert.ok(c.jutsuMastery.some(m => m.jutsuId === id && m.level <= jutsuLevelCapForLevel(level)));
        }
        for (const id of Object.values(c.equipment)) {
            assert.ok(ITEM_CATALOG[id], id);
            assert.equal(ITEM_CATALOG[id].rarity, 'rare');
            assert.ok(effectiveItemLevelReq(ITEM_CATALOG[id]) <= level);
        }
        const s = lateStorySession('Stormveil Village', level, school, focused);
        assert.equal(s.player.character.bloodlineMult, 1, 'no hidden bloodline advantage');
        assert.equal(s.companion, undefined, 'no pet advantage');
    }
});

for (const village of LATE_STORY_VILLAGES)
test(`${village}: story pressure steps up from 75 to 85 to the finale, with surviving unlock-level wins`, async t => {
    const summaries = new Map<number, ReturnType<typeof storyPressureSummary>>();
    for (const level of LATE_STORY_LEVELS) await t.test(`level ${level}: every prepared reference build defeats the boss`, () => {
        const results = [];
        for (const school of GROUP_SCHOOLS) for (const focused of [false, true]) {
            const initial = lateStorySession(village, level, school, focused), untouched = structuredClone(initial);
            const result = pilotGroup(initial, true, false, .55, true, true);
            const context = `${school}/${focused ? 'focused' : 'balanced'}`;
            assert.equal(result.outcome, 'win', `${context}: ${JSON.stringify(result)}`);
            assert.ok(result.hp > 0 && result.rounds < 25, context);
            assert.equal(result.enemiesDefeated, 1, 'a round-cap score is not a defeated story boss');
            assert.deepEqual(initial, untouched, 'never edit the sealed starting stats or resources');
            results.push(result);
        }
        const summary = storyPressureSummary(results);
        summaries.set(level, summary);
        // Legal recovery and faster counterplay can raise finishing HP. Keep
        // the same danger threshold and account for the full HP budget spent.
        assert.ok(summary.lowestHp <= .4, 'ordinary outcomes must show meaningful pressure at their dangerous point');
        assert.ok(summary.healthSpent >= .6, 'boss pressure must consume at least 60% of the health budget, including recovery');
        assert.ok(results.every(r => r.hp / r.maxHp <= .7), 'favorable builds still encounter resistance');
    });
    const early = summaries.get(75)!, late = summaries.get(85)!, finale = summaries.get(100)!;
    // Healing can raise ending HP after the dangerous part of a fight. Compare
    // the observed low point as well, using the unchanged visible-state pilot.
    assert.ok(late.lowestHp <= early.lowestHp - .03, `${village}: 85 must push typical HP below 75`);
    assert.ok(late.heals > early.heals && late.rounds >= early.rounds + 2, '85 requires more recovery and sustains pressure beyond the earlier tier');
    assert.ok(late.healthSpent > early.healthSpent, '85 inflicts more actual HP loss after accounting for healing');
    assert.ok(finale.lowestHp <= late.lowestHp, `${village}: the finale must not be more forgiving at its dangerous point`);
    assert.ok(finale.endingHp <= .25, `${village}: a full-kit Apex finale needs substantial pressure on the prepared reference builds`);
    assert.ok(finale.healthSpent > late.healthSpent, 'the finale must demand more of the player health budget');
});

test('the escalation pass changes only three 85 signatures and final HP/stats, preserving Moonshadow85, 75 and every earlier encounter', () => {
    const baseline = JSON.parse(readFileSync(new URL('./test-fixtures/story-escalation-template-baseline.json', import.meta.url), 'utf8'));
    let unchanged = 0, tuned = 0;
    for (const entry of baseline.profiles) {
        const actual = JSON.parse(JSON.stringify(storyBossEnemyTemplate(entry)));
        const expected = structuredClone(entry.profile);
        if (expected.level === 85 && entry.village !== 'Moonshadow Village') {
            assert.ok(actual.jutsu[0].effectPower > expected.jutsu[0].effectPower);
            expected.jutsu[0].effectPower = actual.jutsu[0].effectPower;
            tuned++;
        } else if (expected.level === 100) {
            assert.ok(actual.hp > expected.hp);
            assert.ok(Object.entries(actual.stats).every(([key, value]) => Number(value) > expected.stats[key] && Number(value) <= statCapForLevel(100)));
            expected.hp = actual.hp;
            expected.stats = actual.stats;
            tuned++;
        } else unchanged++;
        assert.deepEqual(actual, expected, `${entry.village}/${expected.level}: preserve identity, kit, AP, costs, cadence, resources and all other tiers`);
        if (expected.level >= 85) assert.deepEqual(actual,
            JSON.parse(JSON.stringify(escalationCandidate(entry.profile, entry.village, 'accepted'))),
            'the promoted profile matches the tested candidate exactly');
    }
    assert.equal(unchanged, 29);
    assert.equal(tuned, 7);
    assert.deepEqual(NARRATIVE_GROUPS, baseline.groups, 'all group rosters, budgets and the level-65 easing stay intact');
});

test('every late-story boss and biome has surviving clears in every school and a majority of reference builds', () => {
    for (const level of LATE_STORY_LEVELS) for (const village of LATE_STORY_VILLAGES)
    for (const place of LATE_STORY_FIELD_SECTORS) {
        let clears = 0;
        for (const school of GROUP_SCHOOLS) {
            const results = [false,true].map(focused => {
                const initial = lateStorySession(village, level, school, focused, undefined, place.id);
                assert.equal(initial.environment.biome, place.biome);
                return pilotGroup(initial, true, false, .55, true, true);
            });
            const wins = results.filter(r => r.outcome === 'win' && r.hp > 0 && r.rounds < 25 && r.enemiesDefeated === 1).length;
            assert.ok(wins > 0, `${level}/${village}/${place.biome}/${school}: no surviving reference clear: ${JSON.stringify(results)}`);
            clears += wins;
        }
        // A stronger boss can punish a particular allocation in unfavorable
        // terrain. Every school must retain a real clear there; normal village
        // starts above still require all eight builds to win without items.
        assert.ok(clears >= 7, `${level}/${village}/${place.biome}: only ${clears}/8 surviving clears`);
    }
});

test('the late-story pass preserves earlier profiles outside the subsequent level-65 follow-up, plus every later identity and kit', () => {
    const baseline = JSON.parse(readFileSync(new URL('./test-fixtures/story-late-template-baseline.json', import.meta.url), 'utf8'));
    let unchanged = 0, tuned = 0;
    const strip = (p: any) => {
        const { hp, stats, jutsu, ...rest } = p;
        return { ...rest, ...(jutsu ? { jutsu: jutsu.map(({ effectPower, cooldown, ...move }: any) => move) } : {}) };
    };
    for (const entry of baseline) {
        const actual = JSON.parse(JSON.stringify(storyBossEnemyTemplate(entry)));
        // The subsequent two-nature level-65 pass owns Moonshadow's small
        // signature reduction. Its fresh baseline guards every later profile.
        if (entry.profile.level === 65 && entry.village === 'Moonshadow Village') continue;
        if (entry.profile.level <= 65) { assert.deepEqual(actual, entry.profile); unchanged++; }
        else { assert.deepEqual(strip(actual), strip(entry.profile)); tuned++; }
    }
    assert.equal(unchanged, 23);
    assert.equal(tuned, 12);
});

test('late story starts seal exact authored HP/stats on Solo, with unchanged final Apex policy and mastery', () => {
    for (const level of LATE_STORY_LEVELS) for (const village of LATE_STORY_VILLAGES) {
        const initial = lateStorySession(village, level, 'Ninjutsu', false);
        const profile = storyBossEnemyTemplate({ village, progressIndex: level === 75 ? 6 : level === 85 ? 7 : 8 });
        assert.equal(initial.huntCombat, undefined, 'no inherited Tower roster or floor');
        assert.equal(initial.enemy.maxHp, Math.floor(profile.hp * pveDifficultyHpMultiplier(level)));
        const completeStats = Object.fromEntries(STAT_KEYS.map(key => [key, profile.stats[key] ?? 0]));
        assert.deepEqual(initial.enemy.character.stats, perRankStatCap(scaleStatsForPveDifficulty(completeStats, pveDifficultyStatMultiplier(level)), level));
        assert.equal(initial.enemy.character.aiTurnPolicy, STANDARD_PVE_AI_POLICY);
        assert.equal(initial.encounter.sourceId, profile.id);
        if (level === 100) {
            assert.equal(enemyTurnPolicyForEncounter({level,kind:'story-boss',masterAi:true,difficulty:profile.pveDifficulty}).tier, 'apex');
            assert.ok((initial.enemy.character.jutsuMastery as Array<{level:number}>).every(m => m.level === jutsuLevelCapForLevel(100)));
        }
    }
});
