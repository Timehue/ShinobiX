import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { invalidateFieldTrailStateReads, postFieldTrail } from "./field-trail-api";

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
        assert.match(source, /postFieldTrail\(\{ playerName:[\s\S]{0,120}action: "state" \}, controller\.signal\)/);
        assert.match(source, /postFieldTrail\(\{ playerName:[\s\S]{0,120}action: "abandon" \}\)/);
        assert.match(source, /onVersionedCharacterRef\.current\(result\.character, result\._saveVersion\)/);
        assert.match(source, /useFieldTrailRefreshVersion/);
        assert.match(source, /fieldTrailScopeRef\.current !== requestScope/);
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

test("field trail state reads deduplicate only while pending and can be invalidated", { concurrency: false }, async () => {
    const realFetch = globalThis.fetch;
    const resolvers: Array<(response: Response) => void> = [];
    let requests = 0;
    globalThis.fetch = (() => {
        requests += 1;
        return new Promise<Response>((resolve) => resolvers.push(resolve));
    }) as typeof fetch;
    try {
        const params = { playerName: "Rill", missionId: "fetch-d-supply-trail", action: "state" as const };
        const first = postFieldTrail(params);
        const joined = postFieldTrail({ ...params, playerName: "rill" });
        assert.equal(requests, 1, "case-normalized owner reads join the same in-flight request");

        invalidateFieldTrailStateReads("Rill", params.missionId);
        const fresh = postFieldTrail(params);
        assert.equal(requests, 2, "an objective invalidation permits a fresh request before the old one settles");
        for (const resolve of resolvers) resolve(new Response(JSON.stringify({ ok: true, state: null }), { status: 200 }));

        const [firstResult, joinedResult, freshResult] = await Promise.allSettled([first, joined, fresh]);
        assert.equal(firstResult.status, "rejected", "invalidated reads cannot apply an obsolete result");
        assert.equal(joinedResult.status, "rejected");
        assert.equal(freshResult.status, "fulfilled");
        const uncached = postFieldTrail(params);
        assert.equal(requests, 3, "completed reads are not cached");
        resolvers[2](new Response(JSON.stringify({ ok: true, state: null }), { status: 200 }));
        assert.equal((await uncached).ok, true);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test("one unmounted reader does not cancel another owner-matched subscriber", { concurrency: false }, async () => {
    const realFetch = globalThis.fetch;
    let resolveFetch: ((response: Response) => void) | undefined;
    let requests = 0;
    globalThis.fetch = (() => {
        requests += 1;
        return new Promise<Response>(resolve => { resolveFetch = resolve; });
    }) as typeof fetch;
    try {
        const params = { playerName: "Rill", missionId: "fetch-d-supply-trail", action: "state" as const };
        const firstController = new AbortController();
        const secondController = new AbortController();
        const first = postFieldTrail(params, firstController.signal);
        const second = postFieldTrail(params, secondController.signal);
        assert.equal(requests, 1);
        firstController.abort();
        resolveFetch?.(new Response(JSON.stringify({ ok: true, state: null }), { status: 200 }));
        assert.equal((await Promise.allSettled([first]))[0].status, "rejected");
        assert.equal((await second).ok, true);
    } finally {
        globalThis.fetch = realFetch;
        invalidateFieldTrailStateReads("Rill");
    }
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
