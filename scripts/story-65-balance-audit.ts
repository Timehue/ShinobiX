/** All four real level-65 story starts, including Moonshadow's Solo encounter. */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildSoloPveAiEncounter, type SoloPveAiProfile } from '../api/solo-pve/_ai-encounter.js';
import { storyBossEnemyTemplate, STORY_VILLAGE_BIOMES } from '../api/story/_authoritative-story-combat.js';
import { STANDARD_PVE_AI_POLICY } from '../api/solo-pve/_ai-turn-policy.js';
import { applySoloPveAction } from '../api/solo-pve/_engine.js';
import { SECTOR_PLACES, sectorPlace } from '../shared/sector-geo.js';
import { GROUP_SCHOOLS, groupBalanceSave, pilotGroup, type GroupSchool } from './test-fixtures/narrative-group-balance.js';

export const STORY_65_VILLAGES = ['Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village', 'Moonshadow Village'] as const;
export const STORY_65_FIELD_SECTORS = [...new Map(SECTOR_PLACES.map(p => [p.biome, p])).values()];
/** Same modest gear/mastery as the original audit, with two owned natures.
 * Four damaging moves include each nature's area technique; six free slots,
 * no rare weapon, pet, bloodline, consumable or extra progression points. */
export function story65Save(school: GroupSchool, focused: boolean) {
    const save = groupBalanceSave(65, school, focused);
    const prefix = { Ninjutsu: 'nin', Taijutsu: 'tai', Bukijutsu: 'buki', Genjutsu: 'gen' }[school];
    Object.assign(save.character, {
        elements: ['Earth', 'Wind'],
        equippedJutsuIds: ['earth-2', 'earth-aoe', 'wind-2', 'wind-aoe', 'earth-1'].map(suffix => `starter-${prefix}-${suffix}`)
            .concat('starter-universal-flicker'),
    });
    save.character.jutsuMastery = save.character.equippedJutsuIds.map(jutsuId => ({ jutsuId, level: 10 }));
    return save;
}
export async function story65Session(village: typeof STORY_65_VILLAGES[number], school: GroupSchool, focused: boolean,
    alter?: (profile: SoloPveAiProfile) => SoloPveAiProfile, fieldSector = 0) {
    const save = story65Save(school, focused);
    Object.assign(save.character, { village, storyProgress: 5 });
    save.currentSector = fieldSector;
    const profile = storyBossEnemyTemplate({ village, progressIndex: 5 });
    return buildSoloPveAiEncounter({ profile: alter ? alter(profile) : profile, save, playerName: 'fixture',
        sessionId: `story-65-${village}`, now: 1000, admin: null, difficultyMode: 'STORY',
        aiTurnPolicy: STANDARD_PVE_AI_POLICY,
        environment: { biome: (fieldSector > 0 ? sectorPlace(fieldSector)?.biome : undefined) ?? STORY_VILLAGE_BIOMES[village] },
        encounter: { kind: 'story-boss', id: `${village}:5`, sourceId: profile.id } });
}

async function audit() {
    const rows = [];
    const baseline = process.argv.includes('--baseline') ? JSON.parse(readFileSync(new URL('./test-fixtures/story-65-two-nature-template-baseline.json', import.meta.url), 'utf8')) : undefined;
    const groups = process.argv.includes('--groups');
    const stress = process.argv.includes('--stress');
    const field = process.argv.includes('--field');
    for (const village of STORY_65_VILLAGES) {
        if (groups && !['Ashen Leaf Village', 'Frostfang Village'].includes(village)) continue;
        for (const scale of groups ? [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3] : [null])
        for (const school of GROUP_SCHOOLS) for (const focused of [false, true])
        for (const sector of field ? STORY_65_FIELD_SECTORS.map(p => p.id) : [0])
        for (const mode of stress ? ['two-attacks', 'missed-opening', 'no-counters'] : ['standard']) {
            let session = await story65Session(village, school, focused,
                baseline ? () => baseline.profiles.find((p: { village: string; progressIndex: number }) => p.village === village && p.progressIndex === 5).profile : undefined, sector);
            const enemies = session.huntCombat?.battle.actors.filter(a => a.side === 'enemy') ?? [session.enemy];
            const oldGroup = baseline?.groups[session.encounter.sourceId!];
            if (oldGroup) for (const enemy of enemies) enemy.character.towerDmgScale = oldGroup.damageScale ?? 1;
            if (scale !== null) for (const enemy of enemies) enemy.character.towerDmgScale = scale;
            if (mode === 'two-attacks') for (const player of [session.player, ...(session.huntCombat ? [session.huntCombat.battle.actors[0]] : [])]) {
                player.character.jutsu = (player.character.jutsu as Array<{ id: string }>).filter(j => !j.id.endsWith('-aoe'));
            }
            if (mode === 'missed-opening') session = applySoloPveAction(session, session.huntCombat
                ? { type: 'huntAction', action: { type: 'wait' } } : { type: 'wait' }).session;
            const result = pilotGroup(session, mode !== 'no-counters', false, .55, true, true);
            rows.push({ village, school, focused, mode, scale, sector, policy: 'visible-state-counterplay', name: session.enemy.name, count: enemies.length,
                totalEnemyHp: enemies.reduce((n, e) => n + e.maxHp, 0), biome: session.environment.biome, result });
        }
    }
    writeFileSync(process.argv[2], JSON.stringify({ fixture: 'Eight level-65 builds: four schools, balanced/focused earned point budgets; two owned natures Earth/Wind, six catalog techniques including area attacks, uncommon shop armor, mastery10; no weapon/pet/bloodline/consumable/reset. Heal below55% and use visible counters and utility. Real story AI policy and village biome.', rows }, null, 2));
    for (const village of STORY_65_VILLAGES) for (const scale of groups ? [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3] : [null]) {
        const r = rows.filter(r => r.village === village && r.scale === scale);
        if (!r.length) continue;
        console.log(village, scale, r.filter(r => r.result.outcome === 'win' && r.result.hp > 0).length + '/' + r.length,
            'HP%', Math.round(Math.min(...r.map(r => r.result.hp / r.result.maxHp)) * 100), Math.round(Math.max(...r.map(r => r.result.hp / r.result.maxHp)) * 100));
    }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/story-65-balance-audit.ts')) void audit();
