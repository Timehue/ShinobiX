/**
 * Authoritative pet level-growth math.
 *
 * A pet earns one Growth Point per level after level 1. Every level also grants
 * modest automatic core growth, so an unspent pet never becomes dead weight.
 * Allocations are additive from the pet's immutable species stats (before trait
 * bonuses), which prevents rounding drift and source-dependent stat gains.
 */

export const PET_GROWTH_VERSION = 1;
export const PET_CORE_GROWTH_PER_LEVEL = 0.0075;
export const PET_SPECIALIZATION_GROWTH = 0.01;
export const PET_AGILITY_GROWTH = 0.005;
export const PET_MAX_LEVEL = 100;

export type PetGrowthStat = 'hp' | 'attack' | 'defense' | 'speed';
export type PetGrowthAttribute = 'vitality' | 'power' | 'guard' | 'agility';
export type PetGrowthStats = Record<PetGrowthStat, number>;
export type PetGrowthAllocation = Record<PetGrowthAttribute, number>;

export const EMPTY_PET_GROWTH: PetGrowthAllocation = {
    vitality: 0,
    power: 0,
    guard: 0,
    agility: 0,
};

const STAT_ATTRIBUTE: Record<PetGrowthStat, PetGrowthAttribute> = {
    hp: 'vitality',
    attack: 'power',
    defense: 'guard',
    speed: 'agility',
};

const whole = (value: unknown, fallback = 0): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
};

function positiveStat(value: unknown, fallback = 1): number {
    return Math.max(1, whole(value, fallback));
}

export function growthPointsEarned(levelRaw: unknown): number {
    return Math.max(0, Math.min(PET_MAX_LEVEL, whole(levelRaw, 1)) - 1);
}

export function growthAttributeCap(levelRaw: unknown): number {
    return Math.ceil(growthPointsEarned(levelRaw) / 2);
}

export function sanitizeGrowthAllocation(value: unknown, levelRaw: unknown): PetGrowthAllocation {
    const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const cap = growthAttributeCap(levelRaw);
    const clamped: PetGrowthAllocation = {
        vitality: Math.min(cap, Math.max(0, whole(input.vitality))),
        power: Math.min(cap, Math.max(0, whole(input.power))),
        guard: Math.min(cap, Math.max(0, whole(input.guard))),
        agility: Math.min(cap, Math.max(0, whole(input.agility))),
    };
    let remaining = growthPointsEarned(levelRaw);
    (Object.keys(clamped) as PetGrowthAttribute[]).forEach((key) => {
        clamped[key] = Math.min(clamped[key], remaining);
        remaining -= clamped[key];
    });
    return clamped;
}

export function growthPointsSpent(allocation: PetGrowthAllocation): number {
    return allocation.vitality + allocation.power + allocation.guard + allocation.agility;
}

export function traitGrowthBonus(traitRaw: unknown, stat: PetGrowthStat): number {
    const trait = String(traitRaw ?? '');
    if (trait === 'Fateweaver') return 0.20;
    if (trait === 'Battleborn') return 0.10;
    if (trait === 'Hollowborn') return 0.05;
    if (trait === 'Aggressive' && stat === 'attack') return 0.15;
    if (trait === 'Guardian' && (stat === 'hp' || stat === 'defense')) return 0.20;
    if (trait === 'Swift' && stat === 'speed') return 0.20;
    return 0;
}

function fallbackBaseStats(pet: Record<string, unknown>): PetGrowthStats {
    // Compatibility only. Fresh reset-era pets are always initialized with an
    // immutable base by createOwnedPet. Dividing out the trait avoids applying
    // its spawn modifier twice to older records that predate growthVersion.
    const baseFor = (stat: PetGrowthStat) => {
        const live = positiveStat(pet[stat]);
        return Math.max(1, Math.round(live / (1 + traitGrowthBonus(pet.trait, stat))));
    };
    return { hp: baseFor('hp'), attack: baseFor('attack'), defense: baseFor('defense'), speed: baseFor('speed') };
}

export function petGrowthBaseStats(pet: Record<string, unknown>): PetGrowthStats {
    const stored = pet.growthBaseStats && typeof pet.growthBaseStats === 'object'
        ? pet.growthBaseStats as Record<string, unknown>
        : null;
    return stored
        ? {
            hp: positiveStat(stored.hp),
            attack: positiveStat(stored.attack),
            defense: positiveStat(stored.defense),
            speed: positiveStat(stored.speed),
        }
        : fallbackBaseStats(pet);
}

export function agilityGrowthPerPoint(levelRaw: unknown): number {
    void levelRaw;
    // Initiative is already an intrinsic multiplier in Showdown. At the same
    // displayed-stat rate as other attributes, a modest Agility tilt still won
    // 65.8% against a balanced twin. Half-rate prices that intrinsic value.
    return PET_AGILITY_GROWTH;
}

export function derivePetGrowthStats(pet: Record<string, unknown>): PetGrowthStats {
    const level = Math.max(1, Math.min(PET_MAX_LEVEL, whole(pet.level, 1)));
    const earned = growthPointsEarned(level);
    const base = petGrowthBaseStats(pet);
    const allocation = sanitizeGrowthAllocation(pet.growthAllocation, level);
    const core = earned * PET_CORE_GROWTH_PER_LEVEL;
    const result = {} as PetGrowthStats;
    (Object.keys(STAT_ATTRIBUTE) as PetGrowthStat[]).forEach((stat) => {
        const attribute = STAT_ATTRIBUTE[stat];
        const specialization = stat === 'speed' ? agilityGrowthPerPoint(level) : PET_SPECIALIZATION_GROWTH;
        result[stat] = Math.max(1, Math.round(base[stat] * (
            1 + traitGrowthBonus(pet.trait, stat) + core + allocation[attribute] * specialization
        )));
    });
    return result;
}

export function normalizePetGrowth(
    pet: Record<string, unknown>,
    explicitBase?: Partial<PetGrowthStats>,
): Record<string, unknown> {
    const fallback = petGrowthBaseStats(pet);
    const growthBaseStats: PetGrowthStats = {
        hp: positiveStat(explicitBase?.hp, fallback.hp),
        attack: positiveStat(explicitBase?.attack, fallback.attack),
        defense: positiveStat(explicitBase?.defense, fallback.defense),
        speed: positiveStat(explicitBase?.speed, fallback.speed),
    };
    const level = Math.max(1, Math.min(PET_MAX_LEVEL, whole(pet.level, 1)));
    const growthAllocation = sanitizeGrowthAllocation(pet.growthAllocation, level);
    const earned = growthPointsEarned(level);
    const spent = growthPointsSpent(growthAllocation);
    const normalized = {
        ...pet,
        growthVersion: PET_GROWTH_VERSION,
        growthBaseStats,
        growthAllocation,
        growthPoints: Math.max(0, earned - Math.min(earned, spent)),
    };
    return { ...normalized, ...derivePetGrowthStats(normalized) };
}

export function applyGrowthAllocation(
    petRaw: Record<string, unknown>,
    requestedRaw: unknown,
): { ok: true; pet: Record<string, unknown> } | { ok: false; error: string } {
    const pet = normalizePetGrowth(petRaw);
    const level = whole(pet.level, 1);
    const existing = sanitizeGrowthAllocation(pet.growthAllocation, level);
    const raw = requestedRaw && typeof requestedRaw === 'object' ? requestedRaw as Record<string, unknown> : {};
    const cap = growthAttributeCap(level);
    const requested = { ...EMPTY_PET_GROWTH };
    for (const key of Object.keys(requested) as PetGrowthAttribute[]) {
        const parsed = Number(raw[key]);
        if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > cap) {
            return { ok: false, error: `Each attribute must be a whole number from 0 to ${cap}.` };
        }
        requested[key] = parsed;
    }
    if ((Object.keys(requested) as PetGrowthAttribute[]).some((key) => requested[key] < existing[key])) {
        return { ok: false, error: 'Use Respec to remove already committed Growth Points.' };
    }
    if (growthPointsSpent(requested) > growthPointsEarned(level)) {
        return { ok: false, error: 'Not enough Growth Points.' };
    }
    return { ok: true, pet: normalizePetGrowth({ ...pet, growthAllocation: requested }) };
}

export function resetGrowthAllocation(pet: Record<string, unknown>): Record<string, unknown> {
    return normalizePetGrowth({ ...pet, growthAllocation: { ...EMPTY_PET_GROWTH } });
}
