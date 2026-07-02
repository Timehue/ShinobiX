/*
 * The dedicated Legacy signature slot (the "16th slot").
 *
 * Every Legacy grants one signature jutsu (data/legacy-jutsu.ts) once the
 * player reaches Stage 3 (Bound). The slot is DERIVED, not equipped: it comes
 * entirely from the server-owned `character.legacy`, sits outside the 15-jutsu
 * loadout, and cannot be unequipped, traded, or spoofed. The server injects the
 * same signature into sealed PvP/Towers loadouts (api/pvp/session.ts
 * hydrateCharacterFromSave) — these helpers are the PvE/UI mirror of that.
 *
 * Mastery is the Legacy stage ×10 (Bound 3 → 30, Proven 4 → 40, Mythic 5 → 50):
 * signatures deepen as the Legacy deepens, never through the training grind —
 * getJutsuMastery in lib/jutsu-scaling derives it from here, and XP gain is a
 * no-op for legacy ids.
 */
import type { Character } from "../types/character";
import type { Jutsu } from "../types/combat";
import { LEGACY_JUTSU_BY_ID, LEGACY_JUTSU_ID_BY_LEGACY, stampLegacyJutsuType } from "../data/legacy-jutsu";
import { isLegacyEnabled } from "./legacy";

/** Stage 3 (Bound) unlocks the signature. */
export const LEGACY_SIGNATURE_MIN_STAGE = 3;

export function isLegacyJutsuId(jutsuId: string): boolean {
    return LEGACY_JUTSU_BY_ID.has(jutsuId);
}

/** Stage-scaled signature mastery: 3→30, 4→40, 5→50. */
export function legacySignatureMasteryLevel(stage: number): number {
    return Math.min(50, Math.max(0, Math.floor(stage)) * 10);
}

/**
 * The character's active legacy signature, battle-ready (adaptive "Any" damage
 * signatures stamped to the owner's trained specialty — see stampLegacyJutsuType),
 * or null below Stage 3 / without a Legacy / with the legacy.v1 kill-switch off.
 */
export function legacySignatureFor(character: Pick<Character, "legacy" | "specialty"> | null | undefined): Jutsu | null {
    if (!character || !isLegacyEnabled()) return null;
    const lg = character.legacy;
    if (!lg || (lg.stage ?? 0) < LEGACY_SIGNATURE_MIN_STAGE) return null;
    const jutsuId = LEGACY_JUTSU_ID_BY_LEGACY.get(lg.legacyId);
    const jutsu = jutsuId ? LEGACY_JUTSU_BY_ID.get(jutsuId) : undefined;
    return jutsu ? stampLegacyJutsuType(jutsu, character.specialty) : null;
}
