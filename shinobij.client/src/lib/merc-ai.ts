/*
 * Village-War mercenaries — client encounter AIs (Phase 5). The 5 merc tiers as
 * PEAK builtin AIs (lvl 75-100, boss-strength loadout) for the explore-tile
 * random-encounter pool, so a hostile merc can ambush a high-level explorer like
 * any other foe. Their portraits resolve from sharedImages['ai:merc-<tier>'] (art
 * generated separately). The ids start with 'merc-' so the Arena disables the
 * player's PvE pet-summon against them (isMercAiId).
 *
 * NOTE: these CLIENT encounter mercs are a PvE flavor pass — normal explore
 * rewards, NOT contest-affecting. The SECTOR-WAR mercs are server-authoritative
 * (api/towers/_merc-fighters + the /api/village/war-merc `attack` action).
 */
import { makeBuiltinAi, aiJutsuLoadout } from "./combat-ai";
import type { CreatorAi } from "../types/creator-ai";

const MERC_ENCOUNTER_TIERS: ReadonlyArray<{ id: string; name: string; level: number }> = [
    { id: "merc-ronin", name: "Rōnin Blade", level: 75 },
    { id: "merc-reaver", name: "Border Reaver", level: 80 },
    { id: "merc-shadow", name: "Shadow Blade", level: 85 },
    { id: "merc-oni", name: "Oni Mercenary", level: 95 },
    { id: "merc-warlord", name: "Mercenary Warlord", level: 100 },
];

let cached: CreatorAi[] | null = null;
/** The 5 merc tiers as peak encounter AIs (memoized — pure builtin construction). */
export function mercEncounterAis(): CreatorAi[] {
    if (!cached) {
        cached = MERC_ENCOUNTER_TIERS.map((t) =>
            makeBuiltinAi(t.id, t.name, "⚔️", t.level, "Mercenary", aiJutsuLoadout("boss"), 0, undefined, "boss"),
        );
    }
    return cached;
}

/** True for a mercenary opponent (by profile id) — the Arena uses this to disable
 *  the player's PvE pet-summon against mercenaries (owner spec). */
export function isMercAiId(id: string | undefined | null): boolean {
    return typeof id === "string" && id.startsWith("merc-");
}
