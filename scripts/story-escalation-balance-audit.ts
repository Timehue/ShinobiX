/** Compare late-story tiers with fixed acquired builds and the real resolver. */
import { readFileSync, writeFileSync } from 'node:fs';
import { lateStorySession, LATE_STORY_LEVELS, LATE_STORY_VILLAGES, LATE_STORY_FIELD_SECTORS } from './story-late-balance-audit.js';
import { GROUP_SCHOOLS, pilotGroup } from './test-fixtures/narrative-group-balance.js';
import { storyBossEnemyTemplate } from '../api/story/_authoritative-story-combat.js';
type StoryBossProfile = ReturnType<typeof storyBossEnemyTemplate>;

export function storyPressureSummary(results: Array<ReturnType<typeof pilotGroup>>) {
    const median = (values: number[]) => {
        const sorted = [...values].sort((a,b) => a-b);
        return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
    };
    return {
        endingHp: median(results.map(r => r.hp / r.maxHp)),
        lowestHp: median(results.map(r => r.minHp / r.maxHp)),
        heals: median(results.map(r => r.commands.basicHeal ?? 0)),
        healthSpent: median(results.map(r => {
            if (!('healingDone' in r) || typeof r.healingDone !== 'number') throw new Error('Story pressure needs the Solo lifetime healing facts');
            return (r.maxHp + r.healingDone - r.hp) / r.maxHp;
        })),
        rounds: median(results.map(r => r.rounds)),
    };
}

const CANDIDATES: Record<string, { power85: number; moon85: number; moonStats: number; ashenStats: number; moonHp: number; stormStats?: number; stormHp?: number; frost85Hp?: number; frost85Power?: number }> = {
    first: { power85: 76, moon85: 73, moonStats: 1550, ashenStats: 1550, moonHp: 10300 },
    second: { power85: 76, moon85: 70, moonStats: 1650, ashenStats: 1650, moonHp: 10300 },
    third: { power85: 76, moon85: 65, moonStats: 1600, ashenStats: 1650, moonHp: 10300 },
    fourth: { power85: 73, moon85: 65, moonStats: 1575, ashenStats: 1650, moonHp: 10300 },
    fifth: { power85: 73, moon85: 65, moonStats: 1600, ashenStats: 1650, moonHp: 10000 },
    sixth: { power85: 71, moon85: 65, moonStats: 1580, ashenStats: 1625, moonHp: 10000, stormStats: 1525, stormHp: 10000 },
    seventh: { power85: 72, moon85: 65, moonStats: 1600, ashenStats: 1625, moonHp: 10000, stormStats: 1525, stormHp: 10000, frost85Hp: 1.1 },
    accepted: { power85: 72, moon85: 65, moonStats: 1600, ashenStats: 1625, moonHp: 10000, stormStats: 1525, stormHp: 10000, frost85Power: 73 },
};

export function escalationCandidate(profile: StoryBossProfile, village: string, candidate: string): StoryBossProfile {
    if (candidate === 'baseline' || profile.level === 75) return profile;
    const settings = CANDIDATES[candidate];
    if (!settings) throw new Error(`Unknown escalation candidate: ${candidate}`);
    const p = structuredClone(profile);
    if (p.level === 85) {
        if (village === 'Frostfang Village' && settings.frost85Hp) p.hp = Math.round(p.hp * settings.frost85Hp);
        else p.jutsu = p.jutsu!.map(j => ({ ...j, effectPower: village === 'Moonshadow Village' ? settings.moon85
            : village === 'Frostfang Village' ? settings.frost85Power ?? settings.power85 : settings.power85 }));
    } else if (p.level === 100) {
        p.hp = village === 'Moonshadow Village' ? settings.moonHp : village === 'Stormveil Village' ? settings.stormHp ?? 10_300 : 10_300;
        const stat = village === 'Frostfang Village' ? 1475 : village === 'Ashen Leaf Village' ? settings.ashenStats
            : village === 'Moonshadow Village' ? settings.moonStats : settings.stormStats ?? 1550;
        p.stats = Object.fromEntries(Object.keys(p.stats!).map(key => [key, stat]));
    }
    return p;
}

async function audit() {
    const output = process.argv[2];
    const candidateArg = process.argv.indexOf('--candidate');
    const candidate = candidateArg >= 0 ? process.argv[candidateArg + 1] : 'current';
    const baseline = JSON.parse(readFileSync(new URL('./test-fixtures/story-escalation-template-baseline.json', import.meta.url), 'utf8'));
    const levelArg = process.argv.indexOf('--level');
    const onlyLevel = levelArg >= 0 ? Number(process.argv[levelArg + 1]) : undefined;
    const villageArg = process.argv.indexOf('--village');
    const onlyVillage = villageArg >= 0 ? process.argv[villageArg + 1] : undefined;
    const field = process.argv.includes('--field'), rows = [];
    const healArg = process.argv.indexOf('--heal-below');
    const healBelow = healArg >= 0 ? Number(process.argv[healArg + 1]) : .55;
    for (const level of LATE_STORY_LEVELS) {
        if (onlyLevel && level !== onlyLevel) continue;
        for (const village of LATE_STORY_VILLAGES) {
            if (onlyVillage && village !== onlyVillage) continue;
            for (const school of GROUP_SCHOOLS) for (const focused of [false, true])
            for (const sector of field ? LATE_STORY_FIELD_SECTORS.map(p => p.id) : [0]) {
                const alter = candidate === 'current' ? undefined : () => escalationCandidate(
                    baseline.profiles.find((e: { village: string; progressIndex: number }) => e.village === village && e.progressIndex === (level === 75 ? 6 : level === 85 ? 7 : 8)).profile,
                    village, candidate);
                const session = lateStorySession(village, level, school, focused, alter, sector);
                const result = pilotGroup(session, true, false, healBelow, true, true);
                rows.push({ level, village, school, focused, sector, biome: session.environment.biome, result });
                writeFileSync(output, JSON.stringify({ candidate, healBelow, rows }, null, 2));
            }
            const r = rows.filter(r => r.level === level && r.village === village), h = r.map(r => r.result.hp / r.result.maxHp * 100).sort((a,b)=>a-b);
            const median = (h[Math.floor((h.length - 1) / 2)] + h[Math.floor(h.length / 2)]) / 2;
            console.log(level, village, r.filter(r=>r.result.outcome==='win' && r.result.hp>0 && r.result.enemiesDefeated===1).length + '/' + r.length,
                'HP', Math.round(h[0]), Math.round(median), Math.round(h.at(-1)!), 'rounds', Math.min(...r.map(r=>r.result.rounds)), Math.max(...r.map(r=>r.result.rounds)));
        }
    }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/story-escalation-balance-audit.ts')) void audit();
