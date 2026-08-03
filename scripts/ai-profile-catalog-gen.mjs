/*
 * Server-side AI profile catalog generator.
 *
 * api/ and shinobij.client/ are separate build roots with NO shared module, and
 * the built-in AI opponents (`builtinAis`) are DERIVED at import time on the
 * client — `makeBuiltinAi` runs the level curves (aiHpForLevel, aiStatsForLevel,
 * aiRawDamageReductionForLevel) over a jutsu loadout preset. The server has no
 * access to any of that, so before this file it could not name, let alone build,
 * the opponent in a generic AI fight. `kv.get('shared:ai-profiles')` covers only
 * admin-authored AIs and is never written today.
 *
 * That gap is what blocked step 2 of the AI-fight migration
 * (docs/runbooks/combat-mode-migration.md): api/missions/ai-fight-start.ts must
 * seal a real encounter from the SAME opponent the player fights, and it had no
 * profile source. This script derives a self-contained catalog straight from the
 * client's own `builtinAis` so the values can never drift, then writes it as a
 * plain-data TS module the server build compiles (`api/_ai-profile-catalog.ts`).
 *
 *   • Run to regenerate:  node --import tsx scripts/ai-profile-catalog-gen.mjs
 *   • Drift-guarded by:   scripts/ai-profile-catalog.test.mjs (part of `npm test`)
 *
 * `rules` is deliberately DROPPED. It is the client rule-engine program, its
 * `id`s are freshly-minted UUIDs on every import (so mirroring it would make the
 * drift test fail at random), and server-authoritative fights run the tower
 * engine's own AI (api/towers/_engine.ts runAiUntilHuman) rather than the client
 * rule engine. `icon` / `image` / `village` / `armorFactor` are dropped too —
 * cosmetics and a client-only derived field the combat math never reads.
 *
 * Lives in scripts/ (excluded from BOTH build roots) so importing the client
 * data here never pulls client files into the server dist.
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinAis } from "../shinobij.client/src/lib/combat-ai.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "api", "_ai-profile-catalog.ts");

// The exact stat keys aiOpponentEnemyTemplate (api/_authoritative-pve.ts) copies
// onto the EnemyTemplate. Fixed order so the generated file is stable.
const STAT_KEYS = [
    "strength", "speed", "intelligence", "willpower",
    "taijutsuOffense", "taijutsuDefense",
    "bukijutsuOffense", "bukijutsuDefense",
    "ninjutsuOffense", "ninjutsuDefense",
    "genjutsuOffense", "genjutsuDefense",
];

/** Combat-relevant fields only — the set aiOpponentEnemyTemplate reads, plus
 *  `jutsuIds` (resolved to real jutsu by api/_ai-opponent-loadout.ts). */
function pickCombatFields(ai) {
    const stats = {};
    for (const key of STAT_KEYS) stats[key] = Math.max(0, Math.round(Number(ai.stats?.[key] ?? 0)));
    const out = {
        id: ai.id,
        name: ai.name,
        level: Math.round(Number(ai.level)),
        hp: Math.round(Number(ai.hp)),
        chakra: Math.round(Number(ai.chakra)),
        stamina: Math.round(Number(ai.stamina)),
        stats,
        armorRawDR: Number(ai.armorRawDR ?? 0),
        jutsuIds: [...(ai.jutsuIds ?? [])],
    };
    if (ai.loadoutId) out.loadoutId = ai.loadoutId;
    if (ai.isBossAi) out.isBossAi = true;
    if (ai.masterAi) out.masterAi = true;
    if (ai.hpFloorExempt) out.hpFloorExempt = true;
    return out;
}

/**
 * Build the id → profile map from the live client data.
 * Shared with the drift test so the assertion uses the exact same derivation.
 */
export function buildAiProfileCatalog() {
    const catalog = {};
    for (const ai of builtinAis) catalog[ai.id] = pickCombatFields(ai);
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
 * Server-side catalog of the built-in AI opponents, mirrored from the client's
 * \`builtinAis\` (shinobij.client/src/lib/combat-ai.ts) so a server-authoritative
 * AI fight (api/missions/ai-fight-start.ts) can seal the SAME opponent the
 * player sees. Regenerate with:
 *
 *   node --import tsx scripts/ai-profile-catalog-gen.mjs
 *
 * Kept in lock-step with the client by scripts/ai-profile-catalog.test.mjs
 * (runs in \`npm test\`).
 *
 * NOT mirrored: \`rules\` (client rule-engine program with random ids; the tower
 * engine runs its own AI), \`icon\`/\`image\`/\`village\` (cosmetic) and
 * \`armorFactor\` (client-derived from armorRawDR).
 */

export type CatalogAiProfile = {
    id: string;
    name: string;
    level: number;
    hp: number;
    chakra: number;
    stamina: number;
    stats: Record<string, number>;
    armorRawDR: number;
    jutsuIds: string[];
    loadoutId?: string;
    isBossAi?: boolean;
    masterAi?: boolean;
    hpFloorExempt?: boolean;
};

export const AI_PROFILE_CATALOG: Record<string, CatalogAiProfile> = {
${entries}
};

/** Look up a built-in AI profile by id. Returns null for unknown/malformed ids. */
export function builtinAiProfile(id: unknown): CatalogAiProfile | null {
    if (typeof id !== 'string' || !id) return null;
    return Object.prototype.hasOwnProperty.call(AI_PROFILE_CATALOG, id)
        ? AI_PROFILE_CATALOG[id]
        : null;
}
`;
}

// CLI: write the file when run directly (not when imported by the test).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    const catalog = buildAiProfileCatalog();
    writeFileSync(OUT, render(catalog), "utf8");
    console.log(`Wrote ${Object.keys(catalog).length} AI profiles to ${OUT}`);
}
