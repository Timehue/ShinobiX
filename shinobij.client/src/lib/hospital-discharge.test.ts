import { strict as assert } from "node:assert";
import test from "node:test";
import type { Character } from "../types/character";
import { adoptHospitalDischarge } from "./hospital-discharge";

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
