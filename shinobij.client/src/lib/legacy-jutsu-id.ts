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

export { LEGACY_SIGNATURE_MIN_STAGE, legacySignatureMasteryLevel } from "../../../shared/legacy-signature";

export function isLegacyJutsuId(jutsuId: string): boolean {
    return typeof jutsuId === "string" && jutsuId.startsWith(LEGACY_JUTSU_ID_PREFIX);
}
