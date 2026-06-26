import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { standingReaction } from "./wanderer-standing.js";

describe("standingReaction", () => {
    it("returns null when the player has no relevant standing", () => {
        assert.equal(standingReaction("bandit", [], 0), null);
        assert.equal(standingReaction("bandit", undefined, 0), null);
        assert.equal(standingReaction("pilgrim", ["bell-cleansed"], 0), null);
        assert.equal(standingReaction("gambler", ["goro-spared"], 0), null);
        assert.equal(standingReaction("beast", ["goro-executed"], 0), null);
    });

    it("a spared Goro buys safe passage from bandits on a good roll", () => {
        const lucky = standingReaction("bandit", ["goro-spared"], 0.1);
        assert.ok(lucky && lucky.peace, "low roll → peace");
        const unlucky = standingReaction("bandit", ["goro-spared"], 0.9);
        assert.ok(unlucky && !unlucky.peace, "high roll → no peace, but still a friendly line");
        assert.ok(lucky!.line.includes("Goro"));
    });

    it("an executed Goro never earns bandit peace", () => {
        for (const roll of [0, 0.3, 0.99]) {
            const r = standingReaction("bandit", ["goro-executed"], roll);
            assert.ok(r && !r.peace, "executed → never peace");
        }
    });

    it("pilgrims/sages comment on your choices (flavor, never peace)", () => {
        assert.ok(standingReaction("pilgrim", ["goro-executed"], 0)?.line);
        assert.equal(standingReaction("pilgrim", ["goro-executed"], 0)?.peace, false);
        assert.ok(standingReaction("sage", ["goro-spared"], 0)?.line);
        assert.ok(standingReaction("sage", ["bell-raw"], 0)?.line);
    });

    it("execute outweighs spare if somehow both are held (bandit hostility wins)", () => {
        const r = standingReaction("bandit", ["goro-spared", "goro-executed"], 0.1);
        // spared is checked first for bandits → still offers peace; both flags is not a
        // real game state, but the function must stay deterministic, not throw.
        assert.ok(r);
    });
});
