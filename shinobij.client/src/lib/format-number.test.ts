import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { formatCompact, formatExact, formatRatio } from "./format-number";

describe("formatCompact — constrained chips and bars", () => {
    it("keeps values below 10k as plain digits so existing widths are unchanged", () => {
        // Deliberately NOT grouped: adding commas here would widen every bar label.
        assert.equal(formatCompact(0), "0");
        assert.equal(formatCompact(500), "500");
        assert.equal(formatCompact(9999), "9999");
    });

    it("abbreviates at the width where a raw value would overflow the bar label", () => {
        assert.equal(formatCompact(10_000), "10k");
        assert.equal(formatCompact(12_340), "12.3k");
        assert.equal(formatCompact(52_400), "52.4k");
        assert.equal(formatCompact(999_900), "999.9k");
    });

    it("switches to millions for late-game currency", () => {
        assert.equal(formatCompact(1_000_000), "1m");
        assert.equal(formatCompact(1_204_880), "1.2m");
        assert.equal(formatCompact(25_500_000), "25.5m");
    });

    it("never renders NaN or undefined from malformed save data", () => {
        for (const bad of [undefined, null, NaN, "", {}, [], "abc"]) {
            assert.equal(formatCompact(bad), "0", `formatCompact(${JSON.stringify(bad)})`);
        }
        // Numeric strings are real in save blobs and must still work.
        assert.equal(formatCompact("1500"), "1500");
    });

    it("handles negatives without mangling the sign", () => {
        assert.equal(formatCompact(-250), "-250");
        assert.equal(formatCompact(-12_340), "-12.3k");
    });

    it("truncates fractional inputs rather than showing decimals in a chip", () => {
        assert.equal(formatCompact(99.7), "99");
    });
});

describe("formatExact — tooltips and precise reads", () => {
    it("groups with locale separators", () => {
        assert.equal(formatExact(1_204_880), (1_204_880).toLocaleString());
        assert.equal(formatExact(999), "999");
    });

    it("coerces defensively like formatCompact", () => {
        assert.equal(formatExact(undefined), "0");
        assert.equal(formatExact("abc"), "0");
    });
});

describe("formatRatio", () => {
    it("compacts both sides of a resource bar", () => {
        assert.equal(formatRatio(48_291, 52_400), "48.3k/52.4k");
        assert.equal(formatRatio(120, 500), "120/500");
    });
});

describe("HUD adoption", () => {
    it("the mobile status HUD renders bars and currency through one convention", () => {
        // The regression this guards: raw `{character.hp}` next to
        // `character.ryo.toLocaleString()` in the same strip.
        const hud = readFileSync(new URL("../components/MobileStatusHUD.tsx", import.meta.url), "utf8");
        assert.match(hud, /formatCompact/, "bar labels and chips must use the shared compact formatter");
        assert.match(hud, /formatExact/, "titles must show the precise figure");
        assert.doesNotMatch(hud, /character\.ryo\.toLocaleString\(\)/, "currency must not hand-roll its own format");
        assert.doesNotMatch(hud, /\{character\.hp\}/, "bar labels must not render raw values");
    });
});
