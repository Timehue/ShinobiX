/** Real level-75/85/100 story starts; offline balance evidence, no storage. */
import { writeFileSync } from 'node:fs';
import { buildSoloPveAiEncounter, type SoloPveAiProfile } from '../api/solo-pve/_ai-encounter.js';
import { storyBossEnemyTemplate, STORY_VILLAGE_BIOMES } from '../api/story/_authoritative-story-combat.js';
import { STORY_LEVELS } from '../api/story/_settle.js';
import { STANDARD_PVE_AI_POLICY } from '../api/solo-pve/_ai-turn-policy.js';
import { SECTOR_PLACES, sectorPlace } from '../shared/sector-geo.js';
import { JUTSU_CATALOG } from '../api/pvp/_jutsu-catalog.js';
import { ITEM_CATALOG } from '../api/pvp/_item-catalog.js';
import { earnedForLevel } from '../api/_xp-engine.js';
import { effectiveItemLevelReq } from '../shared/item-level-gate.js';
import { GROUP_SCHOOLS, groupBalanceSave, pilotGroup, type GroupSchool } from './test-fixtures/narrative-group-balance.js';

export const LATE_STORY_LEVELS = [75, 85, 100] as const;
export const LATE_STORY_VILLAGES = ['Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village', 'Moonshadow Village'] as const;
export const LATE_STORY_FIELD_SECTORS = [...new Map(SECTOR_PLACES.map(p => [p.biome, p])).values()];
export function lateStorySave(level: number, school: GroupSchool, focused: boolean) {
    const save = groupBalanceSave(level, school, focused, 30);
    const c = save.character as typeof save.character & { elements: string[]; earnedStatPoints: number };
    const prefix = { Ninjutsu: 'nin', Taijutsu: 'tai', Bukijutsu: 'buki', Genjutsu: 'gen' }[school];
    c.elements = ['Earth', 'Wind'];
    c.earnedStatPoints = earnedForLevel(level);
    c.equippedJutsuIds = ['earth-2', 'earth-aoe', 'wind-2', 'wind-aoe'].map(suffix => `starter-${prefix}-${suffix}`)
        .concat('starter-gen-earth-1', 'starter-buki-earth-1', 'starter-gen-wind-1', 'starter-buki-wind-3',
            'starter-gen-earth-3', 'starter-tai-earth-1', 'starter-nin-wind-1', 'starter-universal-flicker');
    if (level === 100) {
        const others = GROUP_SCHOOLS.filter(s => s !== school).slice(0, 2);
        c.equippedJutsuIds = ['earth-2', 'earth-aoe', 'wind-2', 'wind-aoe'].map(suffix => `starter-${prefix}-${suffix}`)
            .concat(...others.map(other => ['earth', 'wind'].map(nature => `starter-${{Ninjutsu:'nin',Taijutsu:'tai',Bukijutsu:'buki',Genjutsu:'gen'}[other]}-${nature}-2`)),
                'starter-gen-earth-1', 'starter-gen-wind-1', 'starter-buki-wind-3', 'starter-universal-flicker');
    }
    c.jutsuMastery = c.equippedJutsuIds.map(jutsuId => ({ jutsuId, level: level === 100 ? 40 : 30 }));
    const hand = { Ninjutsu: 'blue-thread-dagger', Taijutsu: 'riverbone-spear', Bukijutsu: 'ashen-leaf-saber', Genjutsu: 'iron-fang-knuckles' }[school];
    c.equipment = { hand, head: 'iron-kabuto', body: 'rare-chest-plate', waist: 'chain-obi', legs: 'rare-greaves', feet: 'rare-tabi' } as typeof c.equipment;
    c.inventory = Object.values(c.equipment);
    if (c.inventory.some(id => !ITEM_CATALOG[id] || effectiveItemLevelReq(ITEM_CATALOG[id]) > level)
        || c.equippedJutsuIds.some(id => !JUTSU_CATALOG[id] || !['None', ...c.elements].includes(JUTSU_CATALOG[id].element ?? 'None')))
        throw new Error('Late-story fixture contains unavailable gear or an unowned nature');
    return save;
}
export function lateStorySession(village: typeof LATE_STORY_VILLAGES[number], level: typeof LATE_STORY_LEVELS[number], school: GroupSchool,
    focused: boolean, alter?: (profile: SoloPveAiProfile) => SoloPveAiProfile, sector = 0) {
    const save = lateStorySave(level, school, focused);
    const progressIndex = STORY_LEVELS.indexOf(level);
    Object.assign(save.character, { village, storyProgress: progressIndex });
    save.currentSector = sector;
    const profile = storyBossEnemyTemplate({ village, progressIndex });
    return buildSoloPveAiEncounter({ profile: alter ? alter(profile) : profile, save, playerName: 'fixture',
        sessionId: `story-${level}-${village}`, now: 1000, admin: null, difficultyMode: 'STORY', aiTurnPolicy: STANDARD_PVE_AI_POLICY,
        environment: { biome: (sector > 0 ? sectorPlace(sector)?.biome : undefined) ?? STORY_VILLAGE_BIOMES[village] },
        encounter: { kind: 'story-boss', id: `${village}:${progressIndex}`, sourceId: profile.id } });
}

async function audit() {
    const rows = [], field = process.argv.includes('--field'), basic = process.argv.includes('--basic');
    const levelArg = process.argv.indexOf('--level'), onlyLevel = Number(process.argv[levelArg + 1]);
    for (const level of LATE_STORY_LEVELS) {
        if (levelArg >= 0 && level !== onlyLevel) continue;
        for (const village of LATE_STORY_VILLAGES) for (const school of GROUP_SCHOOLS) for (const focused of [false, true])
        for (const sector of field ? LATE_STORY_FIELD_SECTORS.map(p => p.id) : [0]) {
            const session = lateStorySession(village, level, school, focused, undefined, sector);
            const result = pilotGroup(session, true, false, basic ? .45 : .55, !basic, !basic);
            const row = { level, village, school, focused, sector, biome: session.environment.biome,
                name: session.enemy.name, enemyHp: session.enemy.maxHp, policy: basic ? 'basic' : 'prepared', result };
            rows.push(row);
            writeFileSync(process.argv[2], JSON.stringify({ fixture: 'Eight progression-conserved builds: four schools, balanced/focused; rare shop armor and rare school weapon (effectiveLv30), mastery30 at75/85 and40 at100; twelve techniques in two acquired natures Earth/Wind (eight damaging at100); no bloodline/pet/relic/consumable. Real story AI and biome. Prepared policy uses weapon, utility, Clear against active offensive setups and heals below55%.', rows }, null, 2));
        }
        for (const village of LATE_STORY_VILLAGES) {
            const runs = rows.filter(r => r.level === level && r.village === village), hp = runs.map(r => 100 * r.result.hp / r.result.maxHp).sort((a,b)=>a-b);
            console.log(level, village, `${runs.filter(r=>r.result.outcome==='win'&&r.result.hp>0).length}/${runs.length}`,
                'HP%', Math.round(hp[0]), Math.round(hp.at(-1)!), 'median', Math.round((hp[Math.floor((hp.length-1)/2)]+hp[Math.floor(hp.length/2)])/2),
                'rounds', Math.min(...runs.map(r=>r.result.rounds)), Math.max(...runs.map(r=>r.result.rounds)));
        }
    }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/story-late-balance-audit.ts')) void audit();
