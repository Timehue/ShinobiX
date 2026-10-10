import { strict as assert } from "node:assert";
import test from "node:test";
import {
    GARRISON_IDLE_LAPSE_MINUTES,
    GARRISON_STASH_KEY,
    clearGarrisonStash,
    garrisonMountPlan,
    garrisonReportCopy,
    readGarrisonStash,
    writeGarrisonStash,
    type GarrisonResolveResponse,
} from "./sector-war-garrison-api";

/*
 * The garrison assault screen's hand-off (sessionStorage) and its words.
 *
 * Every mount used to call garrison-start, and the server, finding the last run
 * settled, minted a brand-new assault: a refresh on the RESULT screen walked
 * the player straight into another fight. The result text also said "ended
 * without a decision — no points changed hands" for an assault that simply
 * finished after its war had.
 */

function memoryStore() {
    const map = new Map<string, string>();
    return {
        map,
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => { map.set(key, value); },
        removeItem: (key: string) => { map.delete(key); },
    };
}

const character = {} as GarrisonResolveResponse["character"];

test("a finished assault is shown again on a remount, never started over", () => {
    assert.deepEqual(garrisonMountPlan(null), { kind: "lost" });
    // What VillageWarMap writes to launch one.
    assert.deepEqual(garrisonMountPlan({ sector: 12 }), { kind: "start", sector: 12 });
    // Opened, not finished: garrison-start resumes it.
    assert.deepEqual(garrisonMountPlan({ sector: 12, runId: "garrison-a", anbuName: "Frostfang Anbu #1" }), { kind: "start", sector: 12 });
    // Finished: its result comes back, and no new assault is minted behind it.
    assert.deepEqual(
        garrisonMountPlan({ sector: 12, runId: "garrison-a", anbuName: "Frostfang Anbu #1", done: true }),
        { kind: "show-result", runId: "garrison-a", anbuName: "Frostfang Anbu #1" },
    );
});

test("the stash round-trips through storage and keeps the War Map's own shape readable", () => {
    const store = memoryStore();
    store.setItem(GARRISON_STASH_KEY, JSON.stringify({ sector: 7 }));
    assert.deepEqual(readGarrisonStash(store), { sector: 7 });
    writeGarrisonStash({ sector: 7, runId: "garrison-b", anbuName: "The Frostfang Kage", done: true }, store);
    assert.deepEqual(readGarrisonStash(store), { sector: 7, runId: "garrison-b", anbuName: "The Frostfang Kage", done: true });
    clearGarrisonStash(store);
    assert.equal(readGarrisonStash(store), null);
    store.setItem(GARRISON_STASH_KEY, "{not json");
    assert.equal(readGarrisonStash(store), null, "a corrupt hand-off is lost, not thrown");
    assert.equal(readGarrisonStash(null), null, "storage disabled");
});

test("the result says what happened to the war — and only that", () => {
    const base = { ok: true as const, attackerPoints: 4, defenderPoints: 1, character, _saveVersion: 9 };
    const superseded = garrisonReportCopy({ ...base, outcome: "superseded" }, "Frostfang Anbu #1");
    assert.equal(superseded.title, "Assault Over");
    assert.doesNotMatch(superseded.detail, /without a decision|changed hands/, "the war was over; it was not a draw");
    assert.match(superseded.detail, /already over/);

    const stall = garrisonReportCopy({ ...base, outcome: "stall" }, "Frostfang Anbu #1");
    assert.match(stall.detail, /without a decision/, "a genuine draw keeps its own words");

    const fell = garrisonReportCopy({ ...base, outcome: "attacker", attackerWon: true, points: 2, endsAt: 0 }, "Frostfang Anbu #1");
    assert.equal(fell.title, "Garrison Fallen");
    assert.match(fell.detail, /\+2/);
    const capped = garrisonReportCopy({ ...base, outcome: "attacker", attackerWon: true, points: 0, endsAt: 0 }, "Frostfang Anbu #1");
    assert.match(capped.detail, /cap/, "a capped win does not claim a score");

    const held = garrisonReportCopy({ ...base, outcome: "garrison", attackerWon: false, points: 1, endsAt: 0 }, "Frostfang Anbu #1");
    assert.equal(held.title, "The Garrison Held");
    const lapsed = garrisonReportCopy({ ...base, outcome: "garrison", attackerWon: false, points: 1, endsAt: 0, lapsed: true }, "Frostfang Anbu #1");
    assert.match(lapsed.detail, new RegExp(`${GARRISON_IDLE_LAPSE_MINUTES} minutes`), "an idle lapse is named as one");
});

test("an earlier assault, settled on this visit, is labelled as such", () => {
    const base = { ok: true as const, attackerPoints: 2, defenderPoints: 0, character, _saveVersion: 3 };
    const copy = garrisonReportCopy({ ...base, outcome: "attacker", attackerWon: true, points: 2, endsAt: 0 }, "Frostfang Anbu #1", true);
    assert.match(copy.note ?? "", /earlier assault/);
    assert.equal(garrisonReportCopy({ ...base, outcome: "stall" }, "x").note, undefined);
});
