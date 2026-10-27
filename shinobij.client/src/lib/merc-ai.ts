/*
 * Village-War mercenaries — client helpers. The ids start with 'merc-' so the
 * Arena disables the player's PvE pet-summon against them (isMercAiId), and the
 * bundled tier portraits serve the hire / deploy UI (mercPortrait). The
 * SECTOR-WAR mercs are server-authoritative (api/towers/_merc-fighters + the
 * /api/village/war-merc `attack` action).
 */
import mercRoninImg from "../assets/village-war/merc-ronin.webp";
import mercReaverImg from "../assets/village-war/merc-reaver.webp";
import mercShadowImg from "../assets/village-war/merc-shadow.webp";
import mercOniImg from "../assets/village-war/merc-oni.webp";
import mercWarlordImg from "../assets/village-war/merc-warlord.webp";

// Generated portraits (gpt-image-1 / fal), bundled with the code. Also served at
// ai:merc-<tier> if published to KV (scripts/gen-merc-portraits.mjs --publish).
const MERC_IMAGES: Record<string, string> = {
    "merc-ronin": mercRoninImg,
    "merc-reaver": mercReaverImg,
    "merc-shadow": mercShadowImg,
    "merc-oni": mercOniImg,
    "merc-warlord": mercWarlordImg,
};

/** True for a mercenary opponent (by profile id) — the Arena uses this to disable
 *  the player's PvE pet-summon against mercenaries (owner spec). */
export function isMercAiId(id: string | undefined | null): boolean {
    return typeof id === "string" && id.startsWith("merc-");
}

/** The bundled portrait for a merc tier (for the hire / deploy UI). */
export function mercPortrait(tierId: string): string | undefined {
    return MERC_IMAGES[tierId];
}
