import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { briefingWarPriorities, type WarLine } from "./daily-briefing";

describe("daily briefing world report", () => {
    it("features the player's village and clan wars before unrelated conflicts", () => {
        const lines: WarLine[] = [
            { id: "other-1", kind: "village", left: "Leaf", right: "Sand" },
            { id: "other-2", kind: "clan", left: "Crow", right: "Wolf" },
            { id: "home-village", kind: "village", left: "Mist", right: "Stone" },
            { id: "other-3", kind: "village", left: "Rain", right: "Leaf" },
            { id: "home-clan", kind: "clan", left: "Moths", right: "Wolf" },
        ];
        const result = briefingWarPriorities(lines, "mist", "moths");
        assert.deepEqual(result.featured.map((line) => line.id), ["home-village", "home-clan", "other-1"]);
        assert.equal(result.remaining, 2);
        assert.deepEqual(lines.map((line) => line.id), ["other-1", "other-2", "home-village", "other-3", "home-clan"]);
    });

    it("stays bounded when there is no clan or active war", () => {
        assert.deepEqual(briefingWarPriorities([], "Mist", ""), { featured: [], remaining: 0 });
        const conflicts = Array.from({ length: 12 }, (_, i): WarLine => ({ id: String(i), kind: "clan", left: "Crow", right: "Wolf" }));
        const result = briefingWarPriorities(conflicts, "Mist", "");
        assert.equal(result.featured.length, 3);
        assert.equal(result.remaining, 9);
    });
});
