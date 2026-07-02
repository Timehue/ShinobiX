/*
 * Server-side LEGACY jutsu catalog generator.
 *
 * Same split-build-root problem (and same fix) as jutsu-catalog-gen.mjs: the
 * PvP server cannot import client data, so the 100 legacy specialty jutsu
 * (shinobij.client/src/data/legacy-jutsu.ts) are derived into a plain-data TS
 * module the cPanel build can compile.
 *
 * DELIBERATELY a separate catalog from api/pvp/_jutsu-catalog.ts: the built-in
 * JUTSU_CATALOG resolves ids straight out of a save's equippedJutsuIds, so
 * merging legacy jutsu into it would let a tampered save equip a legacy
 * signature inside the 15-jutsu loadout (or without owning the Legacy at all).
 * Legacy jutsu resolve ONLY through the dedicated legacy slot, which validates
 * ownership (character.legacy) against each entry's `legacyId` server-side.
 *
 *   • Run to regenerate:  node --import tsx scripts/legacy-jutsu-catalog-gen.mjs
 *   • Drift-guarded by:   scripts/legacy-jutsu-catalog.test.mjs (part of `npm test`)
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LEGACY_JUTSU_DEFS } from "../shinobij.client/src/data/legacy-jutsu.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "api", "pvp", "_legacy-jutsu-catalog.ts");

// Combat-relevant fields (the same projection as pickCombatFields in
// jutsu-catalog-gen.mjs) + legacyId, which the legacy-slot resolver checks
// against the save's server-owned character.legacy before sealing the jutsu.
function pickFields(def) {
    const j = def.jutsu;
    const out = {
        legacyId: def.legacyId,
        id: j.id,
        name: j.name,
        type: j.type,
        element: j.element,
        ap: j.ap,
        range: j.range,
        effectPower: j.effectPower,
        cooldown: j.cooldown,
        chakraCost: j.chakraCost,
        staminaCost: j.staminaCost,
        target: j.target,
        method: j.method,
        battleDescription: j.battleDescription ?? "",
        tags: (j.tags ?? []).map((t) => {
            const tag = { name: t.name };
            if (t.percent != null) tag.percent = t.percent;
            if (t.amount != null) tag.amount = t.amount;
            return tag;
        }),
    };
    if (j.bloodlineRank) out.bloodlineRank = j.bloodlineRank;
    return out;
}

/** Build the jutsuId → catalog map. Shared with the drift test. */
export function buildLegacyCatalog() {
    const catalog = {};
    for (const def of LEGACY_JUTSU_DEFS) {
        catalog[def.jutsu.id] = pickFields(def);
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
 * Server-side catalog of the 100 Legacy specialty jutsu, used by the dedicated
 * legacy-slot resolver in api/pvp/session.ts. Kept SEPARATE from JUTSU_CATALOG
 * on purpose: these ids must never resolve out of a save's equippedJutsuIds —
 * ownership (character.legacy.legacyId === entry.legacyId) is validated first.
 * Regenerate with:
 *
 *   node --import tsx scripts/legacy-jutsu-catalog-gen.mjs
 *
 * Kept in lock-step with shinobij.client/src/data/legacy-jutsu.ts by
 * scripts/legacy-jutsu-catalog.test.mjs (runs in \`npm test\`).
 */

import type { CatalogJutsu } from './_jutsu-catalog.js';

export type LegacyCatalogJutsu = CatalogJutsu & {
    /** The Legacy that owns this signature (api/_legacy-defs.ts id). */
    legacyId: string;
};

export const LEGACY_JUTSU_CATALOG: Record<string, LegacyCatalogJutsu> = {
${entries}
};

/** legacyId → its signature jutsu id (derived; one signature per Legacy). */
export const LEGACY_JUTSU_ID_BY_LEGACY: Record<string, string> = Object.fromEntries(
    Object.values(LEGACY_JUTSU_CATALOG).map((j) => [j.legacyId, j.id]),
);
`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    const catalog = buildLegacyCatalog();
    writeFileSync(OUT, render(catalog), "utf8");
    console.log(`Wrote ${Object.keys(catalog).length} legacy jutsu to ${OUT}`);
}
