import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { hollowGateSealedCombatOpts } from "./hollow-gate-step-api.ts";

// A step off an unresolved combat tile is refused, and a tile fires only when
// it is stepped onto. When the fight's start failed after the step committed
// (a dropped request, a tile chunk that did not load), nothing ever reopened
// it: the player stood on the tile with Emergency Forfeit as the only exit.
// The refusal now names the encounter and the browser opens it.

test("each sealed tile kind reopens as the same encounter", () => {
    const nodeId = "floor:2:tile:77";
    assert.deepEqual(hollowGateSealedCombatOpts({ nodeId, kind: "battle" }), { nodeId });
    assert.deepEqual(hollowGateSealedCombatOpts({ nodeId, kind: "elite" }), { nodeId, isElite: true });
    assert.deepEqual(hollowGateSealedCombatOpts({ nodeId, kind: "boss" }), { nodeId, isBoss: true });
    assert.deepEqual(hollowGateSealedCombatOpts({ nodeId, kind: "beast" }), { nodeId, isBeast: true });
});

test("App opens the sealed tile's encounter when the server refuses a step off it", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    assert.match(app, /else if \(step\.sealedCombat\) void startHollowGateBattle\(hollowGateSealedCombatOpts\(step\.sealedCombat\)\);/);
});
