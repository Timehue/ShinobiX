/*
 * Drift guard: the committed api/pvp/_legacy-jutsu-catalog.ts must equal what
 * legacy-jutsu-catalog-gen.mjs derives from the live client data — same
 * contract as scripts/jutsu-catalog.test.mjs for the built-in catalog. Fails
 * until the generator is rerun after any change to data/legacy-jutsu.ts.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildLegacyCatalog } from "./legacy-jutsu-catalog-gen.mjs";
import { LEGACY_JUTSU_CATALOG, LEGACY_JUTSU_ID_BY_LEGACY } from "../api/pvp/_legacy-jutsu-catalog.ts";

describe("legacy jutsu catalog is in sync with client data", () => {
    it("committed catalog === generator output (rerun legacy-jutsu-catalog-gen.mjs on mismatch)", () => {
        assert.deepEqual(
            LEGACY_JUTSU_CATALOG,
            buildLegacyCatalog(),
            "api/pvp/_legacy-jutsu-catalog.ts is stale — run: node --import tsx scripts/legacy-jutsu-catalog-gen.mjs",
        );
    });

    it("has exactly 100 signatures, one per Legacy", () => {
        assert.equal(Object.keys(LEGACY_JUTSU_CATALOG).length, 100);
        assert.equal(Object.keys(LEGACY_JUTSU_ID_BY_LEGACY).length, 100, "a duplicate legacyId collapsed the by-legacy map");
    });
});
