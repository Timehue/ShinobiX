import { strict as assert } from "node:assert";
import test from "node:test";
import type { Character } from "../types/character";
import { adoptHospitalDischarge, adoptHealerSnapshot, hospitalDischargeMessage } from "./hospital-discharge";

const admitted = { name: "Patient", hp: 0, maxHp: 100, hospitalized: true } as Character;
const discharged = { ...admitted, hp: 100, hospitalized: false, hospitalizedUntil: 0 };

test("same-tick discharge commits authority before navigation evaluates it", () => {
    const events: string[] = [];
    const accepted = adoptHospitalDischarge(
        { character: discharged, _saveVersion: 8 },
        (character, version) => { events.push(`commit:${character.hospitalized}:${version}`); return true; },
        (screen, character) => { events.push(`navigate:${screen}:${character.hospitalized}`); },
    );
    assert.equal(accepted, true);
    assert.deepEqual(events, ["commit:false:8", "navigate:village:false"]);
});

test("a stale or still-admitted snapshot cannot escape the hospital guard", () => {
    let navigations = 0;
    assert.equal(adoptHospitalDischarge({ character: admitted, _saveVersion: 8 }, () => true, () => { navigations++; }), false);
    assert.equal(adoptHospitalDischarge({ character: discharged, _saveVersion: 7 }, () => false, () => { navigations++; }), false);
    assert.equal(navigations, 0);
});

test('a delayed healer notice cannot clear a later authoritative admission', () => {
    let state = admitted;
    let exits = 0;
    const accepted = adoptHealerSnapshot({ character: admitted, _saveVersion: 12 }, next => { state = next; return true; }, () => exits++);
    assert.equal(accepted, true, 'the reconciled notification can be acknowledged');
    assert.equal(state.hp, 0);
    assert.equal(state.hospitalized, true);
    assert.equal(exits, 0);
});

test('healer recovery adopts the exact save before leaving, and rejects stale versions', () => {
    const events: string[] = [];
    assert.equal(adoptHealerSnapshot({ character: discharged, _saveVersion: 8 }, () => false, () => events.push('exit')), false);
    assert.equal(adoptHealerSnapshot({}, () => true, () => events.push('exit')), false);
    assert.equal(adoptHealerSnapshot({ character: discharged, _saveVersion: 9 }, next => { events.push(`hp:${next.hp}`); return true; }, () => events.push('exit')), true);
    assert.deepEqual(events, ['hp:100', 'exit']);
});

test('a replay confirms discharge without claiming the earlier payment was free', () => {
    assert.match(hospitalDischargeMessage({ chargedRyo: 2500 }), /2,500 ryo/);
    assert.match(hospitalDischargeMessage({ chargedRyo: 0 }), /Discharged free/);
    const replay = hospitalDischargeMessage({ alreadyDischarged: true, chargedRyo: 0 });
    assert.match(replay, /Discharge confirmed/);
    assert.doesNotMatch(replay, /free/i);
});
