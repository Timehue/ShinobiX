import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const harness = readFileSync(new URL("./towerlobby.tsx", import.meta.url), "utf8");

test("Tower lobby harness mirrors expanded floor and ready-room contracts", () => {
    for (const field of [
        "firstClearReward", "fieldRule", "enemyCount", "reinforcementWaves",
        "bossMechanic", "bossTargetMode", "bossStrike", "closingRing", "dynamicHazards",
    ]) assert.match(harness, new RegExp(field));
    assert.match(harness, /defeat-all-then-boss/);
    assert.match(harness, /kill-adds-first/);
    assert.match(harness, /\/api\/towers\/party/);
    assert.match(harness, /hostDisplayName: "Kazuto Uzumaki"/);
    assert.match(harness, /action === "kick"/);
    assert.match(harness, /action === "revoke-invite"/);
    assert.match(harness, /errorCode: "party-required", requiredPartySize: 4/);
    assert.match(harness, /Fight launch is disabled in the lobby-only harness/);
});
