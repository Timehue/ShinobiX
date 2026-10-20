/** Deterministic regression fixtures shared by the node and browser audits. */
import { NARRATIVE_GROUPS } from '../shared/narrative-groups.js';
import { storyBossEnemyTemplate } from '../api/story/_authoritative-story-combat.js';
import { worldRuntimeAiProfile } from '../api/missions/_world-ai-fight.js';
import { AI_PROFILE_CATALOG } from '../api/_ai-profile-catalog.js';
import { buildSoloPveAiEncounter } from '../api/solo-pve/_ai-encounter.js';

export const groupCombatCases = [
    ...Object.keys(NARRATIVE_GROUPS).map(key => ({ key, name: NARRATIVE_GROUPS[key].name ?? key })),
    ...['Stormveil', 'Ashen Leaf', 'Frostfang', 'Moonshadow'].map(v => ({ key: `world-patrol-${v.replaceAll(' ', '-').toLowerCase()}`, name: `${v} Village Patrol Captain` })),
];

export function groupCombatFixture(key: string, name = key, now = 1_800_000_000_000) {
    const match = /^story-ai-(stormveil|ashen-leaf|frostfang)-village-(35|65)$/.exec(key);
    const village = match ? ({ stormveil: 'Stormveil Village', 'ashen-leaf': 'Ashen Leaf Village', frostfang: 'Frostfang Village' } as Record<string, string>)[match[1]] : 'Stormveil Village';
    const progress = match?.[2] === '35' ? 3 : 5;
    const profile = match ? storyBossEnemyTemplate({ village, progressIndex: progress })
        : key === 'road-ai-black-bridge' ? { ...structuredClone(AI_PROFILE_CATALOG[key]), id: key }
            : worldRuntimeAiProfile(key.startsWith('goro-wave-') ? 'world-questbook-qb-caravan-bandit-captain-goro' : key, name, 50, 0, 'bruiser', true);
    if (key.startsWith('goro-wave-')) (profile as Record<string, unknown>).narrativeGroupId = key;
    const character = { name: 'Groupaudit', village, level: 65, storyProgress: progress, specialty: 'Ninjutsu',
        hp: 100000, maxHp: 100000, chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000,
        stats: { ninjutsuOffense: 2200, ninjutsuDefense: 2200, taijutsuDefense: 2200, bukijutsuDefense: 2200, genjutsuDefense: 2200 },
        jutsu: [], inventory: [], ryo: 100, unspentStats: 0, equipment: {}, pets: [], starterCardsClaimed: true, tileCards: [] };
    const params = { profile, save: { character }, playerName: 'groupaudit', sessionId: `audit-${key.replaceAll(':', '-')}`, now, admin: null,
        environment: { biome: 'central', blockedTiles: [45, 81] },
        encounter: { kind: match ? 'story-boss' : 'world-ai', id: match ? `${village}:${progress}` : key, sourceId: profile.id, bindingId: `audit-${key.replaceAll(':', '-')}` } };
    const control = buildSoloPveAiEncounter({ ...params, profile: { ...profile, id: 'ungrouped-audit-control' } });
    const session = buildSoloPveAiEncounter(params);
    return { session, character, control, village, progress };
}

export const groupFinisher = { id: 'audit-group-finisher', name: 'Audit finisher', type: 'Ninjutsu', element: 'None',
    ap: 60, range: 30, effectPower: 100, chakraCost: 0, staminaCost: 0, cooldown: 0, method: 'SINGLE', target: 'OPPONENT', tags: [] };
