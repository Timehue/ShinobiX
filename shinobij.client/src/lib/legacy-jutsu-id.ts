/*
 * Legacy-signature ID helpers — the TABLE-FREE half of the legacy slot.
 *
 * Deliberately does NOT import data/legacy-jutsu.ts: that module builds its
 * lookup Maps at module scope, so any import of it retains the whole ~53 KB
 * jutsu table in the importing chunk — and lib/jutsu-scaling (App's eager
 * graph) only ever needs the ID test and the stage→mastery curve. Splitting
 * these out keeps the table in the lazy screens that render it (Profile /
 * Arena / LegacyPanel) and out of the entry chunk, which sits under a HARD
 * size gate (scripts/check-build-size.mjs ENTRY_JS_FAIL_BYTES).
 *
 * The prefix test is exact, not approximate: every signature id in
 * data/legacy-jutsu.ts starts with this prefix and nothing else does —
 * legacy-jutsu-id-parity.test.ts pins both directions against the real table,
 * so adding a signature without the prefix (or a base jutsu with it) fails CI.
 */

/** Every legacy signature id starts with this; no other jutsu id may. */
export const LEGACY_JUTSU_ID_PREFIX = "legacy-";

/** Stage 3 (Bound) unlocks the signature. */
export const LEGACY_SIGNATURE_MIN_STAGE = 3;

export function isLegacyJutsuId(jutsuId: string): boolean {
    return typeof jutsuId === "string" && jutsuId.startsWith(LEGACY_JUTSU_ID_PREFIX);
}

/** Stage-scaled signature mastery: 3→30, 4→40, 5→50. */
export function legacySignatureMasteryLevel(stage: number): number {
    return Math.min(50, Math.max(0, Math.floor(stage)) * 10);
}
