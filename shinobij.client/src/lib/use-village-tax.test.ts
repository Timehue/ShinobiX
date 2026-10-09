import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { villageTaxVersionToAdopt } from "./use-village-tax";
import type { VillageTaxResult } from "./village-tax-api";

const untaxed = (over: Partial<VillageTaxResult> = {}): VillageTaxResult => ({
    ok: true, enabled: true, applied: false, taxed: 0, toBurn: 0, toTreasury: 0, rateSectors: 0, ryo: 500, bankRyo: 0,
    ...over,
});

// A day with nothing to charge is still STAMPED on the save, which bumps its
// version. The hook adopted the version only when ryo was debited, so on an
// ordinary untaxed day the next autosave was refused as stale.
describe("useVillageTax adopts the stamped version even when nothing was charged", () => {
    it("reads the version off any reply that carries one", () => {
        assert.equal(villageTaxVersionToAdopt(untaxed({ _saveVersion: 42 })), 42);
        assert.equal(villageTaxVersionToAdopt(untaxed()), undefined, "no stamp, nothing to adopt");
        assert.equal(villageTaxVersionToAdopt(untaxed({ _saveVersion: 0 })), undefined);
        assert.equal(villageTaxVersionToAdopt(null), undefined);
    });

    it("the hook adopts it on the untaxed path, before returning", () => {
        const src = readFileSync(new URL("./use-village-tax.ts", import.meta.url), "utf8");
        assert.match(src, /if \(!result\.applied\) \{[\s\S]{0,200}villageTaxVersionToAdopt\(result\)[\s\S]{0,120}onServerVersion\?\.\(version\)/);
        assert.doesNotMatch(src, /!result\?\.applied\) return;/, "the untaxed reply is no longer dropped whole");
    });
});
