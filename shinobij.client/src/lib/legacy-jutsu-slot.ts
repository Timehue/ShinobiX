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
import { LEGACY_SIGNATURE_MIN_STAGE } from "./legacy-jutsu-id";

// The ID test and mastery curve live in ./legacy-jutsu-id, which must NOT
// import the jutsu table — App's eager graph (lib/jutsu-scaling) uses them, and
// importing THIS module would drag the ~53 KB table into the entry chunk (its
// lookup Maps are built at module scope, so tree-shaking can't drop them).
// EAGER CODE IMPORTS ./legacy-jutsu-id DIRECTLY; the re-export here is
// back-compat for the lazy screens that also need legacySignatureFor.
export { LEGACY_SIGNATURE_MIN_STAGE, isLegacyJutsuId, legacySignatureMasteryLevel } from "./legacy-jutsu-id";

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
