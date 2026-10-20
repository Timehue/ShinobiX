import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { STORY_65_VILLAGES, STORY_65_FIELD_SECTORS, story65Save, story65Session } from './story-65-balance-audit.js';
import { GROUP_SCHOOLS, pilotGroup } from './test-fixtures/narrative-group-balance.js';
import { storyBossEnemyTemplate, STORY_VILLAGE_BIOMES } from '../api/story/_authoritative-story-combat.js';
import { STANDARD_PVE_AI_POLICY } from '../api/solo-pve/_ai-turn-policy.js';
import { statCapForLevel } from '../api/combat-core/formulas.js';
import { allocatedStatPoints, earnedForLevel } from '../api/_xp-engine.js';
import { LOADOUT_CAP_BASE } from '../api/_entitlements.js';
import { JUTSU_CATALOG } from '../api/pvp/_jutsu-catalog.js';
import { ITEM_CATALOG } from '../api/pvp/_item-catalog.js';
import { effectiveItemLevelReq } from '../shared/item-level-gate.js';
import { NARRATIVE_GROUPS } from '../shared/narrative-groups.js';

test('level-65 reference builds own both natures and respect earned points, gear gates and free slots', () => {
    for (const school of GROUP_SCHOOLS) for (const focused of [false, true]) {
        const c = story65Save(school, focused).character;
        assert.equal(allocatedStatPoints(c.stats), earnedForLevel(65));
        assert.deepEqual(c.elements, ['Earth', 'Wind']);
        assert.ok(c.equippedJutsuIds.length <= LOADOUT_CAP_BASE);
        for (const id of c.equippedJutsuIds) {
            assert.ok(JUTSU_CATALOG[id], id);
            assert.ok(['None', ...c.elements].includes(JUTSU_CATALOG[id].element ?? 'None'), id);
        }
        for (const id of Object.values(c.equipment)) assert.ok(effectiveItemLevelReq(ITEM_CATALOG[id]) <= 65, id);
        assert.ok(c.jutsuMastery.every(m => m.level === 10));
    }
});

for (const village of STORY_65_VILLAGES) test(`${village}: level-65 boss pressures all four schools while each ordinary build can win`, async () => {
    for (const school of GROUP_SCHOOLS) for (const focused of [false, true]) {
        const initial = await story65Session(village, school, focused), untouched = structuredClone(initial);
        const result = pilotGroup(initial, true, false, .55, true, true);
        const context = `${school}/${focused ? 'focused' : 'balanced'}`;
        assert.equal(result.outcome, 'win', `${context}: ${JSON.stringify(result)}`);
        // Do not force every useful area-attack build below a precise HP target.
        // The requested follow-up is slightly more forgiving, with real wins.
        assert.ok(result.hp > 0 && result.hp <= result.maxHp * .75, `${context}: surviving clear with resistance`);
        assert.equal(result.enemiesDefeated, result.enemies);
        assert.ok(result.rounds < 25, 'clear before the global combat time limit');
        assert.deepEqual(initial, untouched, 'audit never mutates its sealed starting snapshot');
        assert.equal(initial.environment.biome, STORY_VILLAGE_BIOMES[village]);
    }
});

test('travelling does not make a level-65 story boss unbeatable: every school can clear in all five field biomes', async () => {
    for (const village of STORY_65_VILLAGES) for (const place of STORY_65_FIELD_SECTORS)
    for (const school of GROUP_SCHOOLS) for (const focused of [false, true]) {
        const initial = await story65Session(village, school, focused, undefined, place.id);
        // Terrain grants some schools +10% damage. Use the existing defensive
        // utility technique and heal earlier, through actual player actions.
        const result = pilotGroup(initial, true, false, .55, true, true);
        const context = `${village}/${place.biome}/${school}/${focused ? 'focused' : 'balanced'}`;
        assert.equal(initial.environment.biome, place.biome);
        assert.equal(result.outcome, 'win', `${context}: ${JSON.stringify(result)}`);
        assert.ok(result.hp > 0 && result.rounds < 25, context);
        assert.equal(result.enemiesDefeated, result.enemies, context);
    }
});

test('the two-nature follow-up is a small damage reduction and preserves all other story content and budgets', () => {
    const baseline = JSON.parse(readFileSync(new URL('./test-fixtures/story-65-two-nature-template-baseline.json', import.meta.url), 'utf8'));
    for (const entry of baseline.profiles) {
        // The subsequent escalation pass owns 85/100. Its fresh guard pins all
        // earlier profiles, including these accepted level-65 settings.
        if (entry.profile.level >= 85) continue;
        const actual = JSON.parse(JSON.stringify(storyBossEnemyTemplate(entry)));
        const expected = structuredClone(entry.profile);
        if (entry.progressIndex === 5 && entry.village === 'Moonshadow Village') {
            assert.ok(actual.jutsu[0].effectPower < expected.jutsu[0].effectPower);
            assert.ok(actual.jutsu[0].effectPower >= expected.jutsu[0].effectPower * .94);
            expected.jutsu[0].effectPower = actual.jutsu[0].effectPower;
        }
        assert.deepEqual(actual, expected, `${entry.village}/${entry.progressIndex}: no HP, stat, kit or level-75 drift`);
    }
    for (const [id, old] of Object.entries(baseline.groups) as Array<[string, any]>) {
        const actual = NARRATIVE_GROUPS[id];
        const expected = structuredClone(old);
        if (id.startsWith('story-ai-') && id.endsWith('-65')) {
            assert.ok(actual.damageScale! < old.damageScale);
            assert.ok(actual.damageScale! >= old.damageScale * .94, 'only a modest reduction');
            expected.damageScale = actual.damageScale;
        }
        assert.deepEqual(actual, expected, `${id}: preserve rosters, abilities and all other encounters`);
    }
});

test('pre-level-75 story templates retain the level-65 audit baseline outside its three approved changes', () => {
    const baseline = JSON.parse(readFileSync(new URL('./test-fixtures/story-65-template-baseline.json', import.meta.url), 'utf8')) as
        Array<{ village: string; progressIndex: number; profile: Record<string, unknown> }>;
    let unchanged = 0;
    for (const entry of baseline) {
        // The later 75/85/100 pass owns those twelve profiles and its own
        // complete baseline guard, including the final accepted level-65 values.
        if (Number(entry.profile.level) >= 75) continue;
        if (entry.progressIndex === 5 && entry.village !== 'Stormveil Village') continue;
        const actual = JSON.parse(JSON.stringify(storyBossEnemyTemplate(entry)));
        assert.deepEqual(actual, entry.profile, `${entry.village} chapter ${entry.progressIndex}`);
        unchanged++;
    }
    assert.equal(unchanged, 21);
});

test('story starts seal the correct roster, total authored HP, stat caps and real Solo AI policy', async () => {
    for (const village of STORY_65_VILLAGES) {
        const s = await story65Session(village, 'Ninjutsu', false);
        const reference = await story65Session(village, 'Ninjutsu', false, p => ({ ...p, id: 'audit-no-group-budget-reference' }));
        const enemies = s.huntCombat?.battle.actors.filter(a => a.side === 'enemy') ?? [s.enemy];
        assert.equal(enemies.length, village === 'Stormveil Village' ? 9 : village === 'Moonshadow Village' ? 1 : 3);
        assert.equal(enemies.reduce((n, e) => n + e.maxHp, 0), reference.enemy.maxHp, 'HP is the exact sealed profile budget, not a duplicated Tower floor budget');
        for (const enemy of enemies) assert.ok(Object.values(enemy.character.stats as Record<string, number>).every(v => v <= statCapForLevel(65)));
        assert.deepEqual(s.player.character.stats, reference.player.character.stats);
        if (village === 'Moonshadow Village') {
            assert.equal(s.huntCombat, undefined, 'keep the real single-opponent engine');
            assert.equal(s.enemy.character.aiTurnPolicy, STANDARD_PVE_AI_POLICY);
            assert.equal(s.enemy.character.specialty, 'Bukijutsu');
            const kit = s.enemy.character.jutsu as Array<{ type: string; element: string }>;
            assert.ok(kit.every(j => j.type === 'Bukijutsu' && j.element === 'Wind'));
        }
    }
});
