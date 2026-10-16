/** Ordinary combat rolls only. This does not participate in Explore's choice
 * between combat, gathering, pets, chests, and quiet tiles. Server receipts
 * seal the result; the pure helpers also give road-NPC previews the same tell. */
export const ORDINARY_PVE_DIFFICULTIES = ['weaker', 'standard', 'dangerous', 'elite'] as const;
export type OrdinaryPveDifficulty = typeof ORDINARY_PVE_DIFFICULTIES[number];
export type OrdinaryPveArchetype = 'bruiser' | 'skirmisher' | 'assassin' | 'elementalist' | 'defender';

export type OrdinaryPveEncounter = {
    version: 1;
    id: string;
    sourceId: string;
    displayName: string;
    level: number;
    difficulty: OrdinaryPveDifficulty;
    archetype: OrdinaryPveArchetype;
    profileId: string;
    portraitKey: string;
    portraitImage?: string;
    baseXp: number;
    baseRyo: number;
    rewardTrait?: string | null;
};

export const ORDINARY_PVE_ROLES: Record<OrdinaryPveArchetype, { name: string; profileId: string }> = {
    bruiser: { name: 'Road Bruiser', profileId: 'builtin-ai-rogue-ninja' },
    skirmisher: { name: 'Road Skirmisher', profileId: 'builtin-ai-ember-duelist' },
    assassin: { name: 'Rogue Assassin', profileId: 'builtin-ai-shadow-weaver' },
    elementalist: { name: 'Elemental Specialist', profileId: 'builtin-ai-frost-sealer' },
    defender: { name: 'Defensive Specialist', profileId: 'builtin-ai-mist-sentinel' },
};

export function ordinaryPveHash(value: string): number {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 16777619);
    }
    return result >>> 0;
}

/** The starting 35/45/15/5 split is conditional on already rolling combat. */
export function ordinaryPveDifficulty(roll: number): OrdinaryPveDifficulty {
    const unit = Math.max(0, Math.min(.999999999, Number(roll) || 0));
    return unit < .35 ? 'weaker' : unit < .80 ? 'standard' : unit < .95 ? 'dangerous' : 'elite';
}

function levelOf(value: number): number { return Math.max(1, Math.min(100, Math.floor(Number(value) || 1))); }

/** Region ceilings stop the starting roads from following a veteran to 100.
 * A remote region can exceed a novice's level, but by no more than five; the
 * first fifteen levels retain player-level onboarding protection. */
export function ordinaryPveLevel(playerLevel: number, sector: number, difficulty: OrdinaryPveDifficulty, fraction: number): number {
    const player = levelOf(playerLevel);
    const region = Math.max(1, Math.min(100, Math.round(6 + sector * 1.4)));
    const ratio = Math.max(0, Math.min(.999999999, Number(fraction) || 0));
    const target = difficulty === 'weaker' ? Math.floor(player * (.65 + ratio * .20))
        : difficulty === 'standard' ? Math.floor(player * (.90 + ratio * .10))
        : player;
    const dangerFloor = player <= 15 ? 1 : Math.min(Math.floor(region * .55), player + 5);
    // Weaker rolls remain weaker even in a dangerous region; other rolls can
    // signal its minimum danger. The descriptor shows the actual sealed level.
    const minimum = difficulty === 'weaker' ? 1 : dangerFloor;
    return levelOf(Math.min(region, player <= 15 ? player : 100, Math.max(minimum, target)));
}

export function rollOrdinaryPveEncounter(params: {
    sourceId: string;
    playerLevel: number;
    sector: number;
    seed?: string;
    displayName?: string;
    archetype?: OrdinaryPveArchetype;
    portraitKey?: string;
    portraitImage?: string;
    reward?: { xp: number; ryo: number; trait?: string | null };
}): OrdinaryPveEncounter {
    const seed = params.seed ?? params.sourceId;
    const difficulty = ordinaryPveDifficulty(ordinaryPveHash(`${seed}:difficulty`) / 0x100000000);
    const roles = Object.keys(ORDINARY_PVE_ROLES) as OrdinaryPveArchetype[];
    const archetype = params.archetype ?? roles[ordinaryPveHash(`${seed}:role`) % roles.length]!;
    const role = ORDINARY_PVE_ROLES[archetype];
    const level = ordinaryPveLevel(params.playerLevel, params.sector, difficulty, ordinaryPveHash(`${seed}:level`) / 0x100000000);
    return {
        version: 1,
        id: `ordinary-${ordinaryPveHash(`${params.sourceId}:${seed}:${level}:${difficulty}`).toString(16)}`,
        sourceId: params.sourceId,
        displayName: params.displayName ?? role.name,
        level,
        difficulty,
        archetype,
        profileId: role.profileId,
        portraitKey: params.portraitKey ?? archetype,
        ...(params.portraitImage ? { portraitImage: params.portraitImage } : {}),
        baseXp: Math.max(0, Math.floor(params.reward?.xp ?? 100)),
        baseRyo: Math.max(0, Math.floor(params.reward?.ryo ?? 75)),
        ...(params.reward?.trait !== undefined ? { rewardTrait: params.reward.trait } : {}),
    };
}

/** Validate a server receipt/readback. Request-body descriptors are never an
 * authority source, even if they pass this structural check. */
export function cleanOrdinaryPveEncounter(raw: unknown): OrdinaryPveEncounter | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as OrdinaryPveEncounter;
    if (value.version !== 1 || typeof value.id !== 'string' || !/^ordinary-[a-f0-9]{1,8}$/.test(value.id)
        || typeof value.sourceId !== 'string' || !value.sourceId || value.sourceId.length > 96
        || typeof value.displayName !== 'string' || !value.displayName || value.displayName.length > 100
        || !Number.isSafeInteger(value.level) || value.level < 1 || value.level > 100
        || !ORDINARY_PVE_DIFFICULTIES.includes(value.difficulty)
        || !Object.hasOwn(ORDINARY_PVE_ROLES, value.archetype)
        || value.profileId !== ORDINARY_PVE_ROLES[value.archetype].profileId
        || typeof value.portraitKey !== 'string' || value.portraitKey.length > 96
        || !Number.isSafeInteger(value.baseXp) || value.baseXp < 0 || value.baseXp > 10000
        || !Number.isSafeInteger(value.baseRyo) || value.baseRyo < 0 || value.baseRyo > 10000) return null;
    return structuredClone(value);
}
