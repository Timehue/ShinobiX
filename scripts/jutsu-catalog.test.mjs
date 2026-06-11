/*
 * Drift guard: the committed server jutsu catalog (api/pvp/_jutsu-catalog.ts)
 * MUST equal what the client's live data (shinobij.client/src/data/jutsu.ts)
 * resolves to. If a starter/bloodline jutsu's tags, AP, EP, cost, etc. change
 * on the client, `npm test` fails here until the catalog is regenerated with:
 *
 *   node --import tsx scripts/jutsu-catalog-gen.mjs
 *
 * This is the cross-build-root parity mechanism (api/ ⇄ client/ have no shared
 * module). It lives in scripts/ — excluded from both build roots — so importing
 * the client data here never pulls client files into the server dist.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { buildCatalog } from "./jutsu-catalog-gen.mjs";

// The catalog lives under api/ (CommonJS package context), so it can't be a
// static ESM named import from this .mjs file — load it via createRequire (tsx
// hooks the .ts require). The server side (api/pvp/session.ts, also CJS) imports
// it normally with `from './_jutsu-catalog.js'`.
const require = createRequire(import.meta.url);
const { JUTSU_CATALOG } = require("../api/pvp/_jutsu-catalog.ts");

describe("jutsu catalog parity (server ⇄ client)", () => {
    it("committed catalog matches the freshly-derived client data", () => {
        const fresh = buildCatalog();
        assert.deepEqual(
            JUTSU_CATALOG,
            fresh,
            "api/pvp/_jutsu-catalog.ts is stale — run: node --import tsx scripts/jutsu-catalog-gen.mjs",
        );
    });

    it("contains every built-in starter + bloodline jutsu", () => {
        const ids = Object.keys(JUTSU_CATALOG);
        assert.ok(ids.length >= 70, `expected ≥70 catalog jutsu, got ${ids.length}`);
        // Spot-check a known starter and a known bloodline jutsu resolve.
        assert.ok(JUTSU_CATALOG["starter-tai-water-1"], "missing starter-tai-water-1 (Lifesteal jutsu)");
        assert.ok(JUTSU_CATALOG["ashen-eyes-blood-gaze"], "missing a built-in bloodline jutsu");
    });
});
