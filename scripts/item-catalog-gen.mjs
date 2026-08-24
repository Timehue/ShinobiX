/*
 * Server-side item catalog generator. (sibling of scripts/jutsu-catalog-gen.mjs)
 *
 * api/ (cPanel tsc) and shinobij.client/ (Vite) are separate build roots with
 * NO shared module — so the PvP server in api/pvp/move.ts + session.ts has no
 * access to the client's built-in item definitions. That gap is why the combat
 * MULTIPLIER layer (bloodlineMult / armor* / item*Pct) and the equipped-weapon
 * loadout were trusted from whatever the SESSION CREATOR's client supplied
 * instead of being derived from the authoritative save.
 *
 * This script derives a self-contained catalog of the built-in items (the
 * canonical `starterItems`: armor, weapons, throwables, consumables, gear)
 * straight from the client's own data so the values can NEVER drift from what a
 * player actually fights with, then writes it as a plain-data TS module the
 * cPanel build can compile (`api/pvp/_item-catalog.ts`). It also emits the set
 * of built-in (starter) bloodline ids the bloodline-multiplier derivation needs
 * for its flat-1.08 branch (mirrors getBloodlineMultiplier in
 * shinobij.client/src/lib/combat-math.ts).
 *
 *   • Run to regenerate:  node --import tsx scripts/item-catalog-gen.mjs
 *   • Drift-guarded by:   scripts/item-catalog.test.mjs (part of `npm test`)
 *
 * Lives in scripts/ (excluded from BOTH build roots) so importing the client
 * data here never pulls client files into the server dist.
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { starterItems } from "../shinobij.client/src/data/starter-items.ts";
import { eventItems } from "../shinobij.client/src/data/event-items.ts";
import { starterSavedBloodlines } from "../shinobij.client/src/data/jutsu.ts";
import { stackableItemIds } from "../shinobij.client/src/data/pet-config.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "api", "pvp", "_item-catalog.ts");

// Combat-relevant item fields only — what the PvP server reads off an item:
//   • identity (id / name / slot)
//   • armor   (armorQuality + bonuses) for the multiplier layer
//     (api/pvp/_multipliers.ts mirrors getCharacterArmorRawDR / getEquippedItemBonus)
//   • weapon  (the full weapon field set) so equipped weapons resolve to the
//     SAME pvpItem the client's getPvpItemLoadout would build, for
//     api/pvp/move.ts equippedPvpItem + the weapon-jutsu synth.
// Cosmetic-only fields (image / flavorText) are dropped. Cost + levelReq are
// retained so server-authoritative shop purchases use the same live catalog.
// Rarity is intentionally kept: non-combat reward systems such as Clan Exchange
// caches need to roll from real Epic/Legendary catalog pools without trusting
// client-supplied item data.
function pickCombatFields(item) {
    const out = { id: item.id, name: item.name, slot: item.slot, rarity: item.rarity };
    out.cost = Math.max(0, Math.floor(Number(item.cost) || 0));
    if (item.levelReq != null) out.levelReq = Math.max(1, Math.floor(Number(item.levelReq) || 1));
    if (item.serviceItem === true) out.serviceItem = true;
    if (stackableItemIds.has(item.id)) out.stackable = true;
    if (item.armorQuality != null) out.armorQuality = item.armorQuality;
    if (item.weaponElement != null) out.weaponElement = item.weaponElement;
    if (item.weaponRange != null) out.weaponRange = item.weaponRange;
    if (item.weaponCooldown != null) out.weaponCooldown = item.weaponCooldown;
    if (item.weaponEp != null) out.weaponEp = item.weaponEp;
    if (item.weaponEffect != null) out.weaponEffect = item.weaponEffect;
    if (item.weaponEffectValue != null) out.weaponEffectValue = item.weaponEffectValue;
    if (item.weaponEffectTarget != null) out.weaponEffectTarget = item.weaponEffectTarget;
    if (item.apCost != null) out.apCost = item.apCost;
    if (item.restoreChakra != null) out.restoreChakra = item.restoreChakra;
    if (item.restoreStamina != null) out.restoreStamina = item.restoreStamina;
    if (item.weaponTags != null) {
        out.weaponTags = (item.weaponTags ?? []).map((t) => {
            const tag = { name: t.name };
            if (t.percent != null) tag.percent = t.percent;
            return tag;
        });
    }
    // Full bonuses object (armor/weapon stat grants). The multiplier derivation
    // reads only damage/absorb/reflect/lifesteal/shield percent fields off it,
    // but carrying the whole object keeps the catalog faithful to starterItems.
    if (item.bonuses != null) out.bonuses = { ...item.bonuses };
    return out;
}

/**
 * Build the id → catalog-item map from the live client data.
 * Shared with the drift test so the assertion uses the exact same derivation.
 */
export function buildItemCatalog() {
    const catalog = {};
    // Event items are obtainable gear too (the client's getAllItems merges
    // [...starterItems, ...eventItems]) — without them here an equipped event
    // piece is dropped (with a warn) from every server-run fight.
    for (const item of [...starterItems, ...eventItems]) {
        catalog[item.id] = pickCombatFields(item);
    }
    return catalog;
}

/**
 * The ids of the four built-in (starter) bloodlines. getBloodlineMultiplier
 * returns a flat 1.08 for an equipped bloodline that is a starter bloodline but
 * is NOT in the player's own savedBloodlines list — the server derivation needs
 * this set to reproduce that branch.
 */
export function buildBuiltinBloodlineIds() {
    return starterSavedBloodlines.map((b) => b.id).sort();
}

function render(catalog, bloodlineIds) {
    const ids = Object.keys(catalog).sort();
    const entries = ids
        .map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(catalog[id])},`)
        .join("\n");
    const eventIds = [...eventItems.map((item) => item.id)].sort();
    return `/*
 * GENERATED FILE — do not edit by hand.
 *
 * Server-side catalog of built-in items (the canonical starterItems: armor,
 * weapons, throwables, consumables, gear — plus the story eventItems, which
 * are obtainable equipment too), used by api/pvp/session.ts +
 * api/pvp/_multipliers.ts to derive the combat multiplier layer and resolve a
 * player's equipped weapons WITHOUT trusting the session creator's client.
 * Regenerate with:
 *
 *   node --import tsx scripts/item-catalog-gen.mjs
 *
 * Kept in lock-step with shinobij.client/src/data/starter-items.ts +
 * shinobij.client/src/data/event-items.ts + shinobij.client/src/data/jutsu.ts
 * by scripts/item-catalog.test.mjs (runs in \`npm test\`).
 */

export type CatalogItem = {
    id: string;
    name: string;
    slot: string;
    rarity: string;
    cost?: number;
    levelReq?: number;
    serviceItem?: boolean;
    stackable?: boolean;
    armorQuality?: string;
    weaponElement?: string;
    weaponRange?: number;
    weaponCooldown?: number;
    weaponEp?: number;
    weaponEffect?: string;
    weaponEffectValue?: number;
    weaponEffectTarget?: string;
    apCost?: number;
    restoreChakra?: number;
    restoreStamina?: number;
    weaponTags?: Array<{ name: string; percent?: number }>;
    bonuses?: Record<string, number>;
};

export const ITEM_CATALOG: Record<string, CatalogItem> = {
${entries}
};

// Ids of the four built-in (starter) bloodlines — drives the flat-1.08 branch of
// the server bloodline-multiplier derivation (api/pvp/_multipliers.ts).
export const BUILTIN_BLOODLINE_IDS: readonly string[] = ${JSON.stringify(bloodlineIds)};

// Ids of story-event items. In the catalog so equipped event gear resolves in
// server combat, but EXCLUDED from generic reward pools (e.g. the Clan Exchange
// cache rolls) — event items are earned from their events, never re-rolled.
export const EVENT_ITEM_IDS: ReadonlySet<string> = new Set(${JSON.stringify(eventIds)});
`;
}

// CLI: write the file when run directly (not when imported by the test).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    const catalog = buildItemCatalog();
    const bloodlineIds = buildBuiltinBloodlineIds();
    writeFileSync(OUT, render(catalog, bloodlineIds), "utf8");
    console.log(`Wrote ${Object.keys(catalog).length} items + ${bloodlineIds.length} built-in bloodline ids to ${OUT}`);
}
