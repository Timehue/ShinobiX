import { test } from "node:test";
import assert from "node:assert/strict";
import * as contract from "./pet-warfront-contract.ts";

// The lane-war simulator these values used to mirror was retired on
// 2026-10-02, so the contract is their single source. These pins guard the
// numbers the HUD timers and the server's warfront seal read.
test("Warfront contract pins the tick rate, phase clock, stances and doctrines", () => {
    assert.equal(contract.WARFRONT_TPS, 30);
    assert.equal(contract.WF_MAX_SECONDS, 420);
    assert.equal(contract.WF_PHASE_SKIRMISH, 60);
    assert.equal(contract.WF_PHASE_WAR, 180);
    assert.equal(contract.WF_PHASE_SUDDEN, 300);
    assert.deepEqual(contract.WF_STANCES.map(({ id }) => id), ["balanced", "siege", "jungle", "headhunt", "turtle"]);
    assert.deepEqual(contract.WF_DOCTRINES.map(({ id }) => id), ["vanguard", "bulwark", "zealot", "warden-pact"]);
});

test("Warfront verdict counts the towers each side has brought down", () => {
    const snapshot = {
        towers: {
            blue: { n: { alive: false }, m: { alive: true }, s: { alive: true } },
            red: { n: { alive: false }, m: { alive: false }, s: { alive: true } },
        },
    };
    assert.deepEqual(contract.wfVerdictScore(snapshot), { blue: 2, red: 1 });
});
