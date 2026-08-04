import type { AdminCombatContent } from '../_admin-content.js';
import { resolveAiProfileJutsu } from '../_ai-opponent-loadout.js';
import { relevelAiProfile, type RelevelableProfile } from '../_ai-level-curves.js';
import { COMBAT_RESOURCES_V2 } from '../_combat-resources.js';
import {
    pveAiMasteryForLevel,
    pveDifficultyHpMultiplier,
    pveDifficultyStatMultiplier,
    scaleStatsForPveDifficulty,
} from '../_pve-difficulty.js';
import { pveDifficultyGuardEnabled } from '../_pve-band-seal.js';
import { perRankStatCap } from '../combat-core/formulas.js';
import { sealCompanionFromSave } from '../combat-core/companion.js';
import type { PvpFighter } from '../pvp/session.js';
import { hydrateCharacterFromSave, sealItemCharges } from '../pvp/session.js';
import { createSoloPveSession, type SoloPveSession } from './_session.js';

export type SoloPveAiProfile = Record<string, unknown> & { id: string };

export type SoloPveAiScaling = {
    level: number;
    statBonus?: number;
    hpFloor?: number;
};

function finite(value: unknown, fallback: number): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}
function integer(value: unknown, min: number, max: number, fallback: number): number {
    return Math.max(min, Math.min(max, Math.floor(finite(value, fallback))));
}

function specialtyForStats(stats: Record<string, number>): string {
    const choices: Array<[string, string]> = [
        ['Taijutsu', 'taijutsuOffense'],
        ['Bukijutsu', 'bukijutsuOffense'],
        ['Ninjutsu', 'ninjutsuOffense'],
        ['Genjutsu', 'genjutsuOffense'],
    ];
    return choices.sort((a, b) => (stats[b[1]] ?? 0) - (stats[a[1]] ?? 0))[0]?.[0] ?? 'Ninjutsu';
}

function fighterFromHydratedCharacter(character: Record<string, unknown>, pos: number): PvpFighter {
    const maxHp = Math.max(1, finite(character.maxHp, 100));
    const maxChakra = Math.max(0, finite(character.maxChakra, 50));
    const maxStamina = Math.max(0, finite(character.maxStamina, 50));
    const currentHp = Math.max(0, Math.min(maxHp, finite(character.hp, maxHp)));
    const currentChakra = Math.max(0, Math.min(maxChakra, finite(character.chakra, maxChakra)));
    const currentStamina = Math.max(0, Math.min(maxStamina, finite(character.stamina, maxStamina)));
    return {
        name: typeof character.name === 'string' ? character.name : 'Shinobi',
        hp: currentHp,
        maxHp,
        chakra: COMBAT_RESOURCES_V2 ? maxChakra : currentChakra,
        maxChakra,
        stamina: COMBAT_RESOURCES_V2 ? maxStamina : currentStamina,
        maxStamina,
        shield: Math.max(0, Math.min(5_000, finite(character.itemShield, 0))),
        statuses: [],
        character,
        pos,
    };
}

function buildEnemy(profile: SoloPveAiProfile, admin: AdminCombatContent | null, banded: boolean): PvpFighter {
    const level = integer(profile.level, 1, 100, 20);
    const rawStats = profile.stats && typeof profile.stats === 'object' ? profile.stats as Record<string, unknown> : {};
    const numericStats: Record<string, number> = {};
    for (const [key, value] of Object.entries(rawStats)) {
        const number = Number(value);
        if (Number.isFinite(number)) numericStats[key] = Math.max(0, Math.floor(number));
    }
    const scaledStats = banded
        ? scaleStatsForPveDifficulty(numericStats, pveDifficultyStatMultiplier(level))
        : numericStats;
    const stats = perRankStatCap(scaledStats, level);
    const maxHp = Math.max(50, Math.min(5_000_000, Math.floor(
        finite(profile.hp, 240 + level * level * 1.05) * (banded ? pveDifficultyHpMultiplier(level) : 1),
    )));
    const maxChakra = integer(profile.chakra, 100, 20_000, 120 + level * 4);
    const maxStamina = integer(profile.stamina, 100, 20_000, 120 + level * 4);
    const jutsu = resolveAiProfileJutsu(profile.jutsuIds, admin);
    const mastery = pveAiMasteryForLevel(level);
    const specialty = specialtyForStats(stats);
    const character: Record<string, unknown> = {
        name: typeof profile.name === 'string' ? profile.name.slice(0, 80) : 'Opponent',
        level,
        specialty,
        stats,
        armorRawDR: Math.max(0, Math.min(1.5, finite(profile.armorRawDR, 0))),
        jutsu: jutsu.map((entry) => ({ ...entry })),
        jutsuMastery: jutsu.map((entry) => ({ jutsuId: entry.id, level: mastery })),
        visual: profile.id,
        ...(profile.isBossAi === true ? { boss: true } : {}),
        ...(profile.masterAi === true ? { masterAi: true } : {}),
    };
    return {
        name: character.name as string,
        hp: maxHp,
        maxHp,
        chakra: maxChakra,
        maxChakra,
        stamina: maxStamina,
        maxStamina,
        shield: 0,
        statuses: [],
        character,
        pos: 33,
    };
}

/**
 * Build a generic catalog-AI encounter without a Tower floor/session/store.
 * The caller must resolve the profile and augment forged definitions before
 * invoking this function; all combat fields are then sealed from server data.
 */
export function buildSoloPveAiEncounter(params: {
    sessionId: string;
    playerName: string;
    save: Record<string, unknown>;
    profile: SoloPveAiProfile;
    now: number;
    admin: AdminCombatContent | null;
    /** @deprecated Accepted only for wire compatibility; never combat-authoritative. */
    hostLoadout?: Record<string, unknown>;
    scaling?: SoloPveAiScaling;
    env?: NodeJS.ProcessEnv;
}): SoloPveSession {
    const saveCharacter = params.save.character && typeof params.save.character === 'object'
        ? params.save.character as Record<string, unknown>
        : null;
    if (!saveCharacter) throw new Error('Cannot build solo PvE without an authoritative player save.');

    const profile = params.scaling && Number.isFinite(params.scaling.level)
        ? relevelAiProfile(
            params.profile as unknown as RelevelableProfile,
            params.scaling.level,
            params.scaling.statBonus ?? 0,
            params.scaling.hpFloor ?? 0,
            resolveAiProfileJutsu(params.profile.jutsuIds, params.admin),
        ) as unknown as SoloPveAiProfile
        : params.profile;
    const banded = pveDifficultyGuardEnabled('AI_FIGHT', params.env ?? process.env);
    const hydrated = hydrateCharacterFromSave(
        saveCharacter,
        {},
        params.save,
        params.admin,
    );
    const enemy = buildEnemy(profile, params.admin, banded);
    return createSoloPveSession({
        sessionId: params.sessionId,
        ownerSlug: params.playerName,
        encounter: {
            kind: 'generic-ai',
            id: profile.id,
            sourceId: params.profile.id,
            level: Number(enemy.character.level) || 1,
        },
        player: fighterFromHydratedCharacter(hydrated, 62),
        enemy,
        now: params.now,
        environment: { biome: 'central' },
        itemCharges: sealItemCharges(hydrated, saveCharacter),
        companion: sealCompanionFromSave(saveCharacter, params.now),
        ...(banded ? { difficultyEnemyLevel: Number(enemy.character.level) || 1 } : {}),
    });
}
