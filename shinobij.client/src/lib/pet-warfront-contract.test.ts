import { test } from "node:test";
import assert from "node:assert/strict";
import * as contract from "./pet-warfront-contract.ts";
import * as simulation from "./pet-warfront-sim.ts";

test("Warfront UI contract stays byte-for-byte aligned with the authoritative simulator", () => {
    assert.equal(contract.WARFRONT_TPS, simulation.WARFRONT_TPS);
    assert.equal(contract.WF_MAX_SECONDS, simulation.WF_MAX_SECONDS);
    assert.equal(contract.WF_PHASE_SKIRMISH, simulation.WF_PHASE_SKIRMISH);
    assert.equal(contract.WF_PHASE_WAR, simulation.WF_PHASE_WAR);
    assert.equal(contract.WF_PHASE_SUDDEN, simulation.WF_PHASE_SUDDEN);
    assert.deepEqual(contract.WF_STANCES.map(({ id }) => id), ["balanced", "siege", "jungle", "headhunt", "turtle"]);
    assert.deepEqual(contract.WF_DOCTRINES.map(({ id }) => id), ["vanguard", "bulwark", "zealot", "warden-pact"]);
});

test("Warfront UI verdict uses the simulator's structure scoring rule", () => {
    const snapshot = {
        towers: {
            blue: { n: { alive: false }, m: { alive: true }, s: { alive: true } },
            red: { n: { alive: false }, m: { alive: false }, s: { alive: true } },
        },
    };
    assert.deepEqual(contract.wfVerdictScore(snapshot), { blue: 2, red: 1 });
    assert.deepEqual(contract.wfVerdictScore(snapshot), simulation.wfVerdictScore(snapshot as simulation.WfSnapshot));
});
