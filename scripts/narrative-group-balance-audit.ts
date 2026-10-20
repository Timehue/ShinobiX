/** Offline unlock-level audit. No player/storage writes or synthetic finishers. */
import { writeFileSync } from 'node:fs';
import { saveFor } from './test-fixtures/hunt-accessibility.js';
import { simulateBalance } from './test-fixtures/hunt-shrine.js';
import { buildSoloPveAiEncounter } from '../api/solo-pve/_ai-encounter.js';
import { storyBossEnemyTemplate } from '../api/story/_authoritative-story-combat.js';
import { allocatedStatPoints, earnedForLevel } from '../api/_xp-engine.js';
import { groupBalanceSave, GROUP_SCHOOLS, pilotGroup } from './test-fixtures/narrative-group-balance.js';
import { attachStoryTwinCombat } from '../api/story/_twin-combat.js';
import { buildWorldAiFightSpec, applyWorldAiFightSettlement, worldRuntimeAiProfile } from '../api/missions/_world-ai-fight.js';
import { builtinAiProfile } from '../api/_ai-profile-catalog.js';
import { applySoloPveAction } from '../api/solo-pve/_engine.js';

export const unlockGroupCases = [
    ...storyUnlockGroupCases(),
    { key: 'road-ai-black-bridge', level: 52 },
    { key: 'qb-caravan', level: 12, stage: 1, wave: 1 }, { key: 'qb-caravan', level: 12, stage: 1, wave: 2 }, { key: 'qb-caravan', level: 12, stage: 1, wave: 3 },
    { key: 'qb-defector', level: 40, stage: 1 }, { key: 'qb-debt', level: 1, stage: 1 }, { key: 'qb-ashes', level: 50, stage: 0 },
    // The world trigger is level 37, but an active crisis admits lower-level
    // defenders too. Patrols have no personal level gate either.
    { key: 'crisis-frostfang', level: 37 }, { key: 'crisis-frostfang', level: 1 },
    ...['Stormveil', 'Ashen Leaf', 'Frostfang', 'Moonshadow'].flatMap(village =>
        [1, 15, 35].map(level => ({ key: `patrol-${village}`, level }))),
];
function storyUnlockGroupCases() {
    return [
        { key: 'story-stormveil-65', village: 'Stormveil Village', level: 65, progress: 5 },
        { key: 'story-ashen-65', village: 'Ashen Leaf Village', level: 65, progress: 5 },
        { key: 'story-frost-35', village: 'Frostfang Village', level: 35, progress: 3 },
        { key: 'story-frost-65', village: 'Frostfang Village', level: 65, progress: 5 },
        { key: 'twins-stormveil', village: 'Stormveil Village', level: 50, progress: 4 },
        { key: 'twins-frostfang', village: 'Frostfang Village', level: 50, progress: 4 },
    ];
}
export async function unlockGroupSession(entry: typeof unlockGroupCases[number], school: typeof GROUP_SCHOOLS[number], focused: boolean,
    vitals?: { hp: number; chakra: number; stamina: number }) {
    const save = groupBalanceSave(entry.level, school, focused);
    if (vitals) Object.assign(save.character, vitals);
    let profile: Record<string, unknown> & { id: string }, biome = 'forest';
    const isStory = 'village' in entry;
    if (isStory) {
        Object.assign(save.character, { village: entry.village, storyProgress: entry.progress });
        profile = storyBossEnemyTemplate({ village: entry.village, progressIndex: entry.progress });
        biome = entry.village.startsWith('Frost') ? 'snow' : entry.village.startsWith('Ashen') ? 'volcano' : 'forest';
    } else if (entry.key.startsWith('qb-')) {
        const seal = { id: entry.key, stage: 'stage' in entry ? entry.stage : 1, baseline: 0, at: 1000 };
        let character: Record<string, unknown> = save.character;
        let spec: Awaited<ReturnType<typeof buildWorldAiFightSpec>> | undefined;
        for (let wave = 1; wave <= ('wave' in entry ? entry.wave : 1); wave++) {
            spec = await buildWorldAiFightSpec({ playerName: 'fixture', now: 1000,
                request: { kind: 'questbook-boss', sourceId: entry.key, sector: 25 }, save: { ...save, currentSector: 25, activeQuestbookSeal: seal, character } });
            if (wave < ('wave' in entry ? entry.wave : 1)) character = applyWorldAiFightSettlement(character, spec.context, 'win', `balance-wave-${wave}`);
        }
        profile = spec!.profile; biome = spec!.environment.biome ?? 'forest';
    } else if (entry.key === 'crisis-frostfang') {
        profile = worldRuntimeAiProfile('world-crisis-fourfold-breach-v1:frostfang', 'Oathbound Ice Captain and Escorts', entry.level + 1, Math.min(4, Math.floor(entry.level / 12)), 'defender', true);
        biome = 'snow';
    } else if (entry.key.startsWith('patrol-')) {
        const village = entry.key.slice(7);
        profile = worldRuntimeAiProfile(`world-patrol-audit-${village}`, `${village} Village Patrol Captain`, entry.level + 3, 7, 'defender', true);
    } else profile = builtinAiProfile(entry.key)!;
    const session = buildSoloPveAiEncounter({ profile, save, playerName: 'fixture', sessionId: 'group-unlock-balance', now: 1000,
        admin: null, difficultyMode: isStory ? 'STORY' : 'AI_FIGHT', continuousVitals: !isStory, environment: { biome },
        encounter: { kind: isStory ? 'story-boss' : 'world-ai', id: entry.key, sourceId: profile.id } });
    if (isStory) attachStoryTwinCombat(session);
    return session;
}
async function matrix() {
    const rows = [], candidate = process.argv.includes('--candidate');
    const seeds = process.argv.includes('--expanded') ? [1, 7, 42] : [1];
    for (const entry of unlockGroupCases) for (const school of GROUP_SCHOOLS) for (const focused of [false, true]) for (const seed of seeds) {
        const session = await unlockGroupSession(entry, school, focused);
        const actors = session.huntCombat!.battle.actors.filter(a => a.side === 'enemy');
        if (candidate) for (const actor of actors) actor.character.towerDmgScale = actors.length === 9 ? .75 : actors.length === 13 ? .5 : Number(actor.character.towerDmgScale ?? 1);
        session.huntCombat!.battle.seed = seed;
        const result = pilotGroup(session, true, seed === 1 && school === 'Ninjutsu' && !focused);
        rows.push({ key: entry.key, wave: 'wave' in entry ? entry.wave : undefined, level: entry.level, school, focused, seed, count: actors.length, totalEnemyHp: actors.reduce((n, a) => n + a.maxHp, 0), result });
        console.log(JSON.stringify({ key: entry.key, level: entry.level, school, focused, seed, outcome: result.outcome, rounds: result.rounds, hp: result.hp, maxHp: result.maxHp, defeated: result.enemiesDefeated, count: result.enemies }));
    }
    writeFileSync(process.argv[2], JSON.stringify({ candidate, seeds, fixture: 'Exact progression budgets; four schools; balanced/focused; common shop armor (starter robe below5), mastery10 or level cap; no bloodline/pet/relic/consumables; real catalog jutsu; no HP resets; visible counterplay and legal mobility.', rows }, null, 2));
}
async function stress() {
    const rows = [];
    for (const entry of unlockGroupCases.filter(c => c.key === 'story-frost-35' || c.key === 'story-stormveil-65'))
    for (const school of GROUP_SCHOOLS) for (const focused of [false, true]) for (const mode of ['two-attacks', 'missed-opening', 'no-counters']) {
        let session = await unlockGroupSession(entry, school, focused);
        if (mode === 'two-attacks') for (const player of [session.player, session.huntCombat!.battle.actors[0]]) {
            player.character.jutsu = (player.character.jutsu as Array<{ id: string }>).filter(j => !j.id.endsWith('-fire-2') && !j.id.endsWith('-earth-2'));
        }
        if (mode === 'missed-opening') session = applySoloPveAction(session, { type: 'huntAction', action: { type: 'wait' } }).session;
        const result = pilotGroup(session, mode !== 'no-counters');
        rows.push({ key: entry.key, school, focused, mode, result }); console.log(JSON.stringify({ key: entry.key, school, focused, mode, ...result }));
    }
    for (const school of GROUP_SCHOOLS) for (const focused of [false, true]) {
        let vitals: { hp: number; chakra: number; stamina: number } | undefined;
        const waves = [];
        for (const entry of unlockGroupCases.filter(c => c.key === 'qb-caravan')) {
            const result = pilotGroup(await unlockGroupSession(entry, school, focused, vitals));
            waves.push({ wave: 'wave' in entry ? entry.wave : 1, result });
            if (result.hp <= 0 || result.outcome !== 'win') break;
            vitals = { hp: result.hp, chakra: result.chakra, stamina: result.stamina };
        }
        rows.push({ key: 'qb-caravan-carry', school, focused, waves }); console.log(JSON.stringify({ key: 'qb-caravan-carry', school, focused, waves }));
    }
    writeFileSync(process.argv[2], JSON.stringify(rows, null, 2));
}
async function stormveilCandidates() {
    const rows = [], entry = unlockGroupCases.find(c => c.key === 'story-stormveil-65')!;
    for (const scale of [.75, .85, .9, .95, 1, 1.05]) for (const school of GROUP_SCHOOLS) for (const focused of [false, true])
    for (const mode of ['standard', 'two-attacks', 'missed-opening', 'no-counters']) {
        let session = await unlockGroupSession(entry, school, focused);
        for (const actor of session.huntCombat!.battle.actors.filter(a => a.side === 'enemy')) actor.character.towerDmgScale = scale;
        if (mode === 'two-attacks') for (const player of [session.player, session.huntCombat!.battle.actors[0]]) {
            player.character.jutsu = (player.character.jutsu as Array<{ id: string }>).filter(j => !j.id.endsWith('-fire-2') && !j.id.endsWith('-earth-2'));
        }
        if (mode === 'missed-opening') session = applySoloPveAction(session, { type: 'huntAction', action: { type: 'wait' } }).session;
        rows.push({ scale, school, focused, mode, result: pilotGroup(session, mode !== 'no-counters') });
    }
    writeFileSync(process.argv[2], JSON.stringify({ fixture: 'Same legal unlock-level fixtures and visible-state policy as the main matrix; only Stormveil enemy outgoing damage changes.', rows }, null, 2));
}

async function caravanCandidates() {
    const rows = [];
    for (const scale of [.7, .6, .55, .5]) for (const school of GROUP_SCHOOLS) for (const focused of [false, true]) {
        let vitals: { hp: number; chakra: number; stamina: number } | undefined;
        const waves = [];
        for (const entry of unlockGroupCases.filter(c => c.key === 'qb-caravan')) {
            const session = await unlockGroupSession(entry, school, focused, vitals);
            for (const enemy of session.huntCombat!.battle.actors.filter(a => a.side === 'enemy')) enemy.character.towerDmgScale = scale;
            const result = pilotGroup(session); waves.push(result);
            if (result.hp <= 0 || result.outcome !== 'win') break;
            vitals = { hp: result.hp, chakra: result.chakra, stamina: result.stamina };
        }
        const row = { scale, school, focused, cleared: waves.length === 3 && waves.every(r => r.outcome === 'win' && r.hp > 0), hp: waves.at(-1)!.hp, waves };
        rows.push(row); console.log(JSON.stringify({ ...row, waves: undefined }));
    }
    writeFileSync(process.argv[2], JSON.stringify(rows, null, 2));
}

export const storyGroupCases = [
    { village: 'Stormveil Village', level: 65, progress: 5 },
    { village: 'Ashen Leaf Village', level: 65, progress: 5 },
    { village: 'Frostfang Village', level: 35, progress: 3 },
    { village: 'Frostfang Village', level: 65, progress: 5 },
];
export function storyGroupBalanceSession(entry: typeof storyGroupCases[number], build: 'balanced-nin' | 'focused-nin' | 'focused-gen', developing = true) {
    const save = saveFor(entry.level, build, 'reinforced', developing);
    Object.assign(save.character, { village: entry.village, storyProgress: entry.progress, bloodline: 'None', pets: [] });
    if (allocatedStatPoints(save.character.stats) !== earnedForLevel(entry.level)) throw new Error('Invalid stat budget');
    return buildSoloPveAiEncounter({ profile: storyBossEnemyTemplate({ village: entry.village, progressIndex: entry.progress }),
        save, playerName: 'fixture', sessionId: 'group-balance', now: 1000, admin: null, difficultyMode: 'STORY',
        environment: { biome: entry.village.startsWith('Frost') ? 'snow' : entry.village.startsWith('Ashen') ? 'volcano' : 'forest' },
        encounter: { kind: 'story-boss', id: `${entry.village}:${entry.progress}`, sourceId: `story-ai-${entry.village.toLowerCase().replaceAll(' ', '-')}-${entry.level}` } });
}
export function runStoryGroupBalance() {
    const rows = [];
    for (const entry of storyGroupCases) for (const build of ['balanced-nin', 'focused-nin', 'focused-gen'] as const) for (const counters of [false, true]) {
        const session = storyGroupBalanceSession(entry, build);
        const result = simulateBalance(session, false, { useCounters: counters });
        const enemies = session.huntCombat!.battle.actors.filter(a => a.side === 'enemy');
        rows.push({ ...entry, build, counters, enemies: enemies.length, totalEnemyHp: enemies.reduce((n, a) => n + a.maxHp, 0),
            player: { stats: session.player.character.stats, hp: session.player.maxHp, chakra: session.player.maxChakra, stamina: session.player.maxStamina,
                kit: session.player.character.jutsu, equipment: session.player.character.equipment }, result });
        console.log(JSON.stringify({ village: entry.village, level: entry.level, build, counters, count: enemies.length, ...result }));
    }
    return rows;
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/narrative-group-balance-audit.ts')) {
    if (process.argv.includes('--stormveil-candidates')) {
        void stormveilCandidates();
    } else if (process.argv.includes('--caravan-candidates')) {
        void caravanCandidates();
    } else if (process.argv.includes('--stress')) {
        void stress();
    } else if (process.argv.includes('--matrix')) {
        void matrix();
    } else if (process.argv.includes('--candidates')) {
        const rows = [];
        for (const entry of storyGroupCases.filter(e => e.village === 'Stormveil Village' || e.level === 35))
        for (const scale of [0.75, 0.5, 0.35, 0.25]) for (const build of ['balanced-nin', 'focused-nin', 'focused-gen'] as const) {
            const session = storyGroupBalanceSession(entry, build);
            for (const enemy of session.huntCombat!.battle.actors.filter(a => a.side === 'enemy')) enemy.character.towerDmgScale = scale;
            const result = simulateBalance(session, false, { useCounters: true });
            const row = { ...entry, scale, build, ...result }; rows.push(row); console.log(JSON.stringify(row));
        }
        writeFileSync(process.argv[2], JSON.stringify(rows, null, 2));
    } else writeFileSync(process.argv[2] ?? '.tmp/group-balance-baseline.json', JSON.stringify({ fixture: 'Exact earnedForLevel budgets; 1245-ryo level-5 shop armor; mastery 10; catalog techniques; no pet, bloodline, relic, items or HP resets.', rows: runStoryGroupBalance() }, null, 2));
}
