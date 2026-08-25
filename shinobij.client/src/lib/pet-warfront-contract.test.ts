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
    assert.equal(contract.WF_STACK_CAP, simulation.WF_STACK_CAP);
    assert.deepEqual(contract.WF_STANCES, simulation.WF_STANCES);
    assert.deepEqual(contract.WF_DOCTRINES, simulation.WF_DOCTRINES);
    assert.deepEqual(contract.WF_POWERUPS, simulation.WF_POWERUPS);
});

test("Warfront UI verdict uses the simulator's structure scoring rule", () => {
    const snapshot = {
        structures: {
            blue: { statues: [{ alive: false }, { alive: true }], core: { alive: true } },
            red: { statues: [{ alive: false }, { alive: false }], core: { alive: false } },
        },
    };
    assert.deepEqual(contract.wfVerdictScore(snapshot), { blue: 3, red: 1 });
    assert.deepEqual(contract.wfVerdictScore(snapshot), simulation.wfVerdictScore(snapshot as simulation.WfSnapshot));
});
