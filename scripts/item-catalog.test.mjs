/*
 * Drift guard: the committed server item catalog (api/pvp/_item-catalog.ts)
 * MUST equal what the client's live data (shinobij.client/src/data/starter-items.ts
 * + jutsu.ts) resolves to. If a built-in item's weaponEp, tags, armorQuality,
 * bonuses, etc. change on the client — or a built-in bloodline id changes —
 * `npm test` fails here until the catalog is regenerated with:
 *
 *   node --import tsx scripts/item-catalog-gen.mjs
 *
 * This is the cross-build-root parity mechanism (api/ ⇄ client/ have no shared
 * module). It lives in scripts/ — excluded from both build roots — so importing
 * the client data here never pulls client files into the server dist.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { buildItemCatalog, buildBuiltinBloodlineIds } from "./item-catalog-gen.mjs";

// The catalog lives under api/ (CommonJS package context), so it can't be a
// static ESM named import from this .mjs file — load it via createRequire (tsx
// hooks the .ts require). The server side (api/pvp/session.ts, also CJS) imports
// it normally with `from './_item-catalog.js'`.
const require = createRequire(import.meta.url);
const { ITEM_CATALOG, BUILTIN_BLOODLINE_IDS } = require("../api/pvp/_item-catalog.ts");

describe("item catalog parity (server ⇄ client)", () => {
    it("committed catalog matches the freshly-derived client data", () => {
        const fresh = buildItemCatalog();
        assert.deepEqual(
            ITEM_CATALOG,
            fresh,
            "api/pvp/_item-catalog.ts is stale — run: node --import tsx scripts/item-catalog-gen.mjs",
        );
    });

    it("built-in bloodline id set matches the client", () => {
        assert.deepEqual(
            BUILTIN_BLOODLINE_IDS,
            buildBuiltinBloodlineIds(),
            "api/pvp/_item-catalog.ts bloodline ids are stale — run: node --import tsx scripts/item-catalog-gen.mjs",
        );
    });

    it("contains the built-in armor + weapons the multiplier/weapon derivation needs", () => {
        const ids = Object.keys(ITEM_CATALOG);
        assert.ok(ids.length >= 100, `expected ≥100 catalog items, got ${ids.length}`);
        // A legendary armor piece carries armorQuality + a passive percent bonus.
        const armor = ITEM_CATALOG["legendary-crown"];
        assert.ok(armor && armor.armorQuality === "Legendary", "missing legendary-crown armorQuality");
        assert.ok(armor.bonuses && typeof armor.bonuses.damagePercent === "number", "missing legendary-crown damagePercent bonus");
        // A built-in weapon carries weaponEp + a weaponEffect.
        const weapon = ITEM_CATALOG["ashen-dragon-katana"];
        assert.ok(weapon && typeof weapon.weaponEp === "number", "missing a built-in weapon's weaponEp");
    });
});
