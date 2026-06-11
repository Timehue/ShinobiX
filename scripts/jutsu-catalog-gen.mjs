/*
 * Server-side jutsu catalog generator.
 *
 * api/ (cPanel tsc) and shinobij.client/ (Vite) are separate build roots with
 * NO shared module — so the PvP server in api/pvp/move.ts has no access to the
 * client's built-in jutsu definitions. That gap is the root cause of the
 * "defender's jutsu don't load" bug: the server could not resolve a player's
 * `equippedJutsuIds` into real jutsu objects, so it trusted whatever loadout
 * the SESSION CREATOR's client supplied — which, for an attacked opponent, is
 * only the public projection (jutsu stripped) → an empty loadout.
 *
 * This script derives a self-contained catalog of the built-in jutsu (the
 * already-rebalanced `starterJutsus` + the four built-in `starterSavedBloodlines`)
 * straight from the client's own data so the values can NEVER drift from what a
 * player actually fights with, then writes it as a plain-data TS module the
 * cPanel build can compile (`api/pvp/_jutsu-catalog.ts`).
 *
 *   • Run to regenerate:  node --import tsx scripts/jutsu-catalog-gen.mjs
 *   • Drift-guarded by:   scripts/jutsu-catalog.test.mjs (part of `npm test`)
 *
 * Lives in scripts/ (excluded from BOTH build roots) so importing the client
 * data here never pulls client files into the server dist.
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { starterJutsus, starterSavedBloodlines } from "../shinobij.client/src/data/jutsu.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "api", "pvp", "_jutsu-catalog.ts");

// Combat-relevant fields only — the exact set api/pvp/move.ts reads off a jutsu
// object (id, name, type, element, ap, range, effectPower, cooldown,
// chakraCost, staminaCost, target, method, tags, bloodlineRank). The big text
// + image fields are intentionally dropped (the server never renders them).
function pickCombatFields(jutsu, bloodlineRank) {
    const out = {
        id: jutsu.id,
        name: jutsu.name,
        type: jutsu.type,
        element: jutsu.element,
        ap: jutsu.ap,
        range: jutsu.range,
        effectPower: jutsu.effectPower,
        cooldown: jutsu.cooldown,
        chakraCost: jutsu.chakraCost,
        staminaCost: jutsu.staminaCost,
        target: jutsu.target,
        method: jutsu.method,
        tags: (jutsu.tags ?? []).map((t) => {
            const tag = { name: t.name };
            if (t.percent != null) tag.percent = t.percent;
            if (t.amount != null) tag.amount = t.amount;
            return tag;
        }),
    };
    if (bloodlineRank) out.bloodlineRank = bloodlineRank;
    return out;
}

/**
 * Build the id → catalog-jutsu map from the live client data.
 * Shared with the drift test so the assertion uses the exact same derivation.
 */
export function buildCatalog() {
    const catalog = {};
    // Non-bloodline starters (already rebalanced via rebalanceNonBloodlineJutsu).
    for (const jutsu of starterJutsus) {
        catalog[jutsu.id] = pickCombatFields(jutsu, undefined);
    }
    // The four built-in bloodlines — getAllJutsus stamps each jutsu with its
    // bloodline's rank (markRank), which the server's Wound rank-cap reads.
    for (const bloodline of starterSavedBloodlines) {
        for (const jutsu of bloodline.jutsus ?? []) {
            catalog[jutsu.id] = pickCombatFields(jutsu, bloodline.rank ?? "B Rank");
        }
    }
    return catalog;
}

function render(catalog) {
    const ids = Object.keys(catalog).sort();
    const entries = ids
        .map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(catalog[id])},`)
        .join("\n");
    return `/*
 * GENERATED FILE — do not edit by hand.
 *
 * Server-side catalog of built-in jutsu (rebalanced starters + the four
 * built-in bloodlines), used by api/pvp/session.ts to resolve a player's
 * equippedJutsuIds into authoritative jutsu objects WITHOUT trusting the
 * session creator's client. Regenerate with:
 *
 *   node --import tsx scripts/jutsu-catalog-gen.mjs
 *
 * Kept in lock-step with shinobij.client/src/data/jutsu.ts by
 * scripts/jutsu-catalog.test.mjs (runs in \`npm test\`).
 */

export type CatalogJutsu = {
    id: string;
    name: string;
    type: string;
    element: string;
    ap: number;
    range: number;
    effectPower: number;
    cooldown: number;
    chakraCost: number;
    staminaCost: number;
    target: string;
    method: string;
    tags: Array<{ name: string; percent?: number; amount?: number }>;
    bloodlineRank?: string;
};

export const JUTSU_CATALOG: Record<string, CatalogJutsu> = {
${entries}
};
`;
}

// CLI: write the file when run directly (not when imported by the test).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    const catalog = buildCatalog();
    writeFileSync(OUT, render(catalog), "utf8");
    console.log(`Wrote ${Object.keys(catalog).length} jutsu to ${OUT}`);
}
