/*
 * War Mercenaries — client DISPLAY mirror of the server-sealed tier table
 * (api/village/_mercenaries.ts owns the authoritative cost/damage; the hire is
 * recomputed there). Same mirror pattern as the wanderer quest catalog. Keep the
 * five tiers + costs in sync with the server module.
 */
export interface MercenaryTier {
    id: string;
    level: number;
    name: string;
    blurb: string;
    costSeals: number;
    warDamage: number;
}

export const MERCENARY_TIERS: MercenaryTier[] = [
    { id: "merc-ronin",   level: 75,  name: "Rōnin Blade",       blurb: "A masterless sword for hire — cheap, reliable, gone by morning.", costSeals: 150,  warDamage: 120 },
    { id: "merc-reaver",  level: 80,  name: "Border Reaver",     blurb: "Raiders who know the enemy's supply lines better than their Kage.", costSeals: 250,  warDamage: 200 },
    { id: "merc-shadow",  level: 85,  name: "Shadow-for-Hire",   blurb: "Nukenin who strike from the dark and never sign a name.",        costSeals: 400,  warDamage: 320 },
    { id: "merc-oni",     level: 95,  name: "Oni Mercenary",     blurb: "A demon-masked killer the enemy will feel before they see.",     costSeals: 650,  warDamage: 500 },
    { id: "merc-warlord", level: 100, name: "Mercenary Warlord", blurb: "An entire warband under one banner — the price of a small army.", costSeals: 1000, warDamage: 750 },
];

/** Tiers already hired for the given active war (resets when warId changes). */
export function hiredTiersForWar(
    warMercs: { warId: string; tiers: string[] } | null | undefined,
    activeWarId: string | null | undefined,
): string[] {
    if (!warMercs || !activeWarId || warMercs.warId !== activeWarId) return [];
    return Array.isArray(warMercs.tiers) ? warMercs.tiers : [];
}
