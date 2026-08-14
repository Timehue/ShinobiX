import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { postFieldTrail } from "./field-trail-api";

test("field trail lifecycle sends only stable contract identity", { concurrency: false }, async () => {
    const realFetch = globalThis.fetch;
    let body: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
            ok: true,
            state: { missionId: "fetch-d-supply-trail", runId: "run_1234567890123456", acceptedAt: 10 },
            acceptedMissionIds: ["fetch-d-supply-trail"],
            missionProgress: { "fetch-d-supply-trail": 0 },
            character: { name: "Rill" },
            _saveVersion: 9,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
        const result = await postFieldTrail({ playerName: "Rill", missionId: "fetch-d-supply-trail", action: "accept" });
        assert.equal(result.state?.runId, "run_1234567890123456");
        assert.deepEqual(body, { playerName: "Rill", missionId: "fetch-d-supply-trail", action: "accept" });
    } finally {
        globalThis.fetch = realFetch;
    }
});

test("both field-mission screens and explore progress use the same server run", () => {
    const missions = readFileSync(new URL("../screens/Missions.tsx", import.meta.url), "utf8");
    const logbook = readFileSync(new URL("../screens/Logbook.tsx", import.meta.url), "utf8");
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    for (const source of [missions, logbook]) {
        assert.match(source, /postFieldTrail\(\{ playerName:[\s\S]{0,120}action: "accept" \}\)/);
        assert.match(source, /postFieldTrail\(\{ playerName:[\s\S]{0,120}action: "state" \}\)/);
        assert.match(source, /postFieldTrail\(\{ playerName:[\s\S]{0,120}action: "abandon" \}\)/);
        assert.match(source, /onVersionedCharacter\(result\.character, result\._saveVersion\)/);
        const acceptStart = Math.max(source.indexOf("async function acceptFetchMission"), source.indexOf("async function acceptMission"));
        const claimedToday = source.indexOf('result.reason === "already-claimed-today"', acceptStart);
        const acceptedToast = source.indexOf("accepted. Explore Sector", claimedToday);
        assert.ok(claimedToday >= 0 && acceptedToast > claimedToday,
            "a cleaned claimed-today response must return before any accepted presentation");
        assert.match(source.slice(claimedToday, acceptedToast), /return alert/);
    }
    assert.match(app, /serverFieldMissionRuns\?\.\[missionId\]\?\.runId/);
    assert.match(app, /JSON\.stringify\(\{[\s\S]{0,220}runId/,
        "the exact accepted run must accompany its explore receipt");
});

test("claimed-today reconciliation payload survives a conflict response", { concurrency: false }, async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
        ok: false,
        reason: "already-claimed-today",
        state: null,
        acceptedMissionIds: [],
        missionProgress: {},
        character: { name: "Rill", ryo: 900 },
        _saveVersion: 22,
    }), { status: 409, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    try {
        const result = await postFieldTrail({ playerName: "Rill", missionId: "fetch-d-supply-trail", action: "accept" });
        assert.equal(result.ok, false);
        assert.equal(result.reason, "already-claimed-today");
        assert.equal(result.character?.ryo, 900);
        assert.deepEqual(result.acceptedMissionIds, []);
        assert.equal(result._saveVersion, 22);
    } finally {
        globalThis.fetch = realFetch;
    }
});
