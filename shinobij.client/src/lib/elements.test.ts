/*
 * weatherElementOf — the element a jutsu uses for the weather system. Bloodline
 * jutsu set an explicit weatherElement (a base element, or "None" for no weather
 * interaction); starters/items fall back to their own element. This lib is
 * mirrored inline in api/pvp/move.ts, so the semantics are locked here.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { weatherElementOf } from "./elements";

describe("weatherElementOf", () => {
    it("uses the explicit weatherElement when set", () => {
        assert.equal(weatherElementOf({ weatherElement: "Fire", element: "Crystal" }), "Fire");
    });

    it("keeps 'None' so a flavor element gets no weather interaction", () => {
        // "None" never equals a weather's positive/negative element (all 5 base
        // elements), so the weather multiplier stays 1.0.
        assert.equal(weatherElementOf({ weatherElement: "None", element: "Fire" }), "None");
    });

    it("falls back to the jutsu's own element when weatherElement is absent", () => {
        assert.equal(weatherElementOf({ element: "Water" }), "Water");
    });

    it("returns an empty string when neither is set", () => {
        assert.equal(weatherElementOf({}), "");
    });
});
