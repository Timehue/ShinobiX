/*
 * War Mercenaries — what is left of the Town Hall Honor-Seal hire, RETIRED
 * 2026-10-08 (owner ruling): village-war mercenaries are now hired as AI bands
 * from the Sector War Map, paid in War Resources (lib/village-war-map.ts
 * hireMerc). The Honor-Seal tier catalog that only the Town Hall hire buttons
 * read is gone with them; what remains reads the player's own history —
 * `character.warMercs`, the server-sealed list of bands they hired with seals
 * in a war (api/_war-mercenary-hire.ts writes it).
 */

/** The id a seal hire was filed under for this war: its pair-row id plus the
 *  declaration generation (mirror of api/village/hire-mercenary.ts
 *  villageWarGenerationToken). */
export function villageWarHireToken(war: { id: string; declarationGeneration?: number } | null | undefined): string | null {
    if (!war?.id) return null;
    const generation = Math.floor(Number(war.declarationGeneration) || 0);
    return Number.isSafeInteger(generation) && generation > 0 ? `${war.id}-g${generation}` : war.id;
}

/** Tiers already hired for the given active war (resets when warId changes). */
export function hiredTiersForWar(
    warMercs: { warId: string; tiers: string[] } | null | undefined,
    activeWarId: string | null | undefined,
): string[] {
    if (!warMercs || !activeWarId || warMercs.warId !== activeWarId) return [];
    return Array.isArray(warMercs.tiers) ? warMercs.tiers : [];
}
