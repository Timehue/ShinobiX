import { builtinAiProfile } from '../_ai-profile-catalog.js';
import { relevelAiProfile, type RelevelableProfile } from '../_ai-level-curves.js';
import { resolveAiProfileJutsu } from '../_ai-opponent-loadout.js';
import type { AdminCombatContent } from '../_admin-content.js';
import type { EnemyTemplate } from '../towers/_enemy-templates.js';
import type { TowerFloor } from '../towers/_floor-catalog.js';
import {
    WORLD_CRISIS_80_TOWER_ID,
    type WorldCrisis80EncounterDefinition,
} from '../../shared/world-crisis-80.js';

export const WORLD_CRISIS_80_FLOOR_ID = 80;

export function buildWorldCrisis80Floor(encounter: WorldCrisis80EncounterDefinition): TowerFloor {
    return {
        id: WORLD_CRISIS_80_FLOOR_ID,
        name: `${encounter.triadName}: Ledger Defense`,
        biome: encounter.biome,
        objective: 'defeat-all',
        roundBudget: 14,
        map: { width: 18, height: 12 },
        fieldRule: { kind: 'debuff', tag: 'Increase Damage Taken', percent: 4 },
        enemies: encounter.triad.map((_, index) => ({ aiId: `${WORLD_CRISIS_80_TOWER_ID}-cell-${index + 1}`, count: 1 })),
        terrainPillars: 8,
        closingRing: { pct: 3, fromRound: 5, minRadius: 2 },
        dynamicHazards: [{ kind: 'geyser', count: 3, pct: 4, everyRounds: 3, firstRound: 3 }],
        balanceFor: 1,
        firstClearReward: {},
        chapter: 8,
        chapterTitle: 'Four Witnesses, One Record',
        chapterSubtitle: `${encounter.ledgerName} · ${encounter.village} outskirts`,
        chapterSummary: `Break all three members of the ${encounter.triadName} before they seize the witness ledger.`,
        artKey: `world-crisis-80-${encounter.biome}`,
        briefing: {
            situation: `A Hollow Gate collection cell has reached ${encounter.ledgerName}. Three specialists are attacking as one unit.`,
            tactics: [
                'The vanguard screens the other claimants; reposition before committing your strongest technique.',
                'The marksman hunts exposed targets while the assessor disrupts resources and control.',
                'The perimeter contracts from round five. End the cell before the ledger is isolated.',
            ],
            warnings: ['Elite 1-vs-3 encounter', 'Three distinct focus policies', 'Closing perimeter and recurring floor vents'],
        },
    };
}

function scaledProfile(profileId: string, level: number, admin: AdminCombatContent | null): RelevelableProfile {
    const base = builtinAiProfile(profileId);
    if (!base) throw new Error(`Missing crisis AI profile: ${profileId}`);
    const loadout = resolveAiProfileJutsu(base.jutsuIds, admin);
    return relevelAiProfile(structuredClone(base) as unknown as RelevelableProfile, level, 4, 0, loadout);
}

/** Three individually lighter opponents whose combined pressure is materially
 * above an ordinary equal-level duel. Names/roles come from the village's
 * authored cell; every combat number and technique is rebuilt server-side. */
export function buildWorldCrisis80EnemyTemplates(
    encounter: WorldCrisis80EncounterDefinition,
    playerLevelRaw: unknown,
    admin: AdminCombatContent | null,
): Record<string, EnemyTemplate> {
    const playerLevel = Math.max(20, Math.min(100, Math.floor(Number(playerLevelRaw) || 1)));
    const enemyLevel = Math.min(100, playerLevel + 2);
    return Object.fromEntries(encounter.triad.map((member, index) => {
        const profile = scaledProfile(member.profileId, enemyLevel, admin);
        const jutsu = resolveAiProfileJutsu(profile.jutsuIds, admin);
        const stats = Object.fromEntries(Object.entries(profile.stats).map(([key, value]) => [
            key,
            Math.max(1, Math.floor(Number(value) * member.statMultiplier)),
        ]));
        const template: EnemyTemplate = {
            name: member.name,
            specialty: member.specialty,
            level: enemyLevel,
            hp: Math.max(350, Math.floor(Number(profile.hp) * member.hpMultiplier)),
            maxChakra: Math.max(100, Math.floor(Number(profile.chakra) * .76)),
            maxStamina: Math.max(100, Math.floor(Number(profile.stamina) * .76)),
            stats,
            visual: member.visual,
            role: member.role,
            targetMode: member.targetMode,
            armorRawDR: Math.max(0, Number(profile.armorRawDR) * .72),
            jutsu,
        };
        return [`${WORLD_CRISIS_80_TOWER_ID}-cell-${index + 1}`, template];
    }));
}
