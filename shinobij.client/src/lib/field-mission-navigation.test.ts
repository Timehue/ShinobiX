import assert from "node:assert/strict";
import test from "node:test";
import { takeFieldMissionNavigationIntent, writeFieldMissionNavigationIntent } from "./field-mission-navigation";

function storage() {
    const values = new Map<string, string>();
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
    };
}

test("field mission navigation carries its owner, destination, and next action once", () => {
    const session = storage();
    writeFieldMissionNavigationIntent("Rill O'Neil", {
        missionId: "fetch-d-supply-trail", targetSector: 18, objective: "raid",
    }, session);
    assert.equal(takeFieldMissionNavigationIntent("Other", session), null);
    assert.deepEqual(takeFieldMissionNavigationIntent("rilloneil", session), {
        owner: "rilloneil", missionId: "fetch-d-supply-trail", targetSector: 18, objective: "raid",
    });
    assert.equal(takeFieldMissionNavigationIntent("rilloneil", session), null);
});

test("malformed field mission navigation is consumed and ignored", () => {
    const session = storage();
    session.setItem("fieldMissionNavigation.v1", JSON.stringify({ owner: "rill", missionId: "x", targetSector: 18, objective: "teleport" }));
    assert.equal(takeFieldMissionNavigationIntent("rill", session), null);
    assert.equal(session.getItem("fieldMissionNavigation.v1"), null);
});
