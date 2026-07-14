export const PET_EXPEDITION_TYPES = ['scout', 'forage', 'ruins'] as const;
export type PetExpeditionType = typeof PET_EXPEDITION_TYPES[number];

export interface PetExpeditionSeal {
    playerName: string;
    petId: string;
    expType: PetExpeditionType;
    durationMinutes: number;
    petLevel: number;
    endsAt: number;
    expRewardMult: number;
    expMaterialMult: number;
    rewardScale: number;
    tamer: boolean;
}
type RecordLike = Record<string, unknown>;

const recordOf = (value: unknown): RecordLike | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as RecordLike : null;

const clamped = (value: unknown, min: number, max: number) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
};

/**
 * Resolve an expedition only when the request token still owns the exact saved
 * pet lease. The nested serverSeal is written for new runs; the conservative
 * fallback migrates older leases that predate it.
 */
export function petExpeditionSealForToken(characterRaw: unknown, token: string, playerName: string): PetExpeditionSeal | null {
    const character = recordOf(characterRaw);
    if (!character || !/^[A-Za-z0-9]+$/.test(token)) return null;
    const pets = Array.isArray(character.pets) ? character.pets as unknown[] : [];
    for (const rawPet of pets) {
        const pet = recordOf(rawPet);
        const expedition = recordOf(pet?.expedition);
        if (!pet || !expedition || expedition.token !== token) continue;
        const expType = PET_EXPEDITION_TYPES.includes(expedition.type as PetExpeditionType)
            ? expedition.type as PetExpeditionType
            : null;
        const startedAt = Number(expedition.startedAt);
        const endsAt = Number(expedition.endsAt);
        const durationMinutes = Math.floor(Number(expedition.durationMs) / 60_000);
        if (!expType || !Number.isSafeInteger(startedAt) || !Number.isSafeInteger(endsAt) || endsAt <= startedAt) return null;
        if (!Number.isSafeInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 24 * 60) return null;

        const saved = recordOf(expedition.serverSeal);
        const isTamer = character.profession === 'petTamer';
        const maxed = Number(pet.level) >= Number(pet.maxLevel ?? 100);
        if (!saved && !isTamer && !maxed) return null;
        return {
            playerName,
            petId: String(pet.id ?? ''),
            expType,
            durationMinutes,
            petLevel: Math.floor(clamped(saved?.petLevel ?? pet.level, 1, 100)),
            endsAt,
            expRewardMult: clamped(saved?.expRewardMult ?? 1, 1, 2),
            expMaterialMult: clamped(saved?.expMaterialMult ?? 1, 1, 2),
            rewardScale: clamped(saved?.rewardScale ?? (isTamer ? 1 : 0.5), 0, 1),
            tamer: saved ? saved.tamer !== false : isTamer,
        };
    }
    return null;
}
