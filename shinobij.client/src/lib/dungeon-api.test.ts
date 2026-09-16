import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DungeonProbeError, dungeonProbeFailureMessage, probeFreeDungeonServer } from "./dungeon-api";

test("free-dungeon probes replay one stable id and adopt the sealed sector", { concurrency: false }, async () => {
    const realFetch = globalThis.fetch;
    let body: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_url, init) => {
        body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return new Response(JSON.stringify({
            ok: true,
            requestId: "olderprobe123",
            found: false,
            token: "",
            sector: 33,
            character: { name: "Rill", serverFreeDungeonProbesToday: 1 },
            _saveVersion: 19,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
        const result = await probeFreeDungeonServer("Rill", 61, "newprobe123");
        assert.deepEqual(body, {
            playerName: "Rill", action: "probe-free", sector: 61, requestId: "newprobe123",
        });
        assert.equal(result.requestId, "olderprobe123", "cross-device recovery must rebind to the server receipt");
        assert.equal(result.sector, 33, "the newly clicked sector cannot replace the sealed discovery sector");
        assert.equal(result.found, false);
        assert.equal(result.resolved, false);
        assert.equal(result._saveVersion, 19);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test("resolved dungeon receipts retire without resurrecting a spent run", { concurrency: false }, async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
        ok: true,
        requestId: "settledprobe123",
        found: true,
        resolved: true,
        token: "spentdungeontoken123",
        sector: 33,
        character: { name: "Rill", activeDungeonRun: null },
        _saveVersion: 20,
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    try {
        const result = await probeFreeDungeonServer("Rill", 61, "settledprobe123");
        assert.equal(result.resolved, true);
        assert.equal(result.found, true);
    } finally {
        globalThis.fetch = realFetch;
    }

    const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    const continueDiscovery = worldMap.slice(
        worldMap.indexOf("async function continueWorldDiscovery"),
        worldMap.indexOf("async function resolveExplore"),
    );
    const resolved = continueDiscovery.indexOf("if (probe.resolved)");
    const launch = continueDiscovery.indexOf("onDungeonFound(probe.token)");
    assert.ok(resolved >= 0 && launch > resolved);
    assert.match(continueDiscovery.slice(resolved, launch), /return "recovered"/,
        "the terminal replay must return before the stale token can open Dungeon");
});

test("definitive probe conflicts retire while transport failures stay retryable", { concurrency: false }, async () => {
    const realFetch = globalThis.fetch;
    try {
        globalThis.fetch = (async () => new Response(JSON.stringify({ error: "active-dungeon-conflict" }), {
            status: 409, headers: { "Content-Type": "application/json" },
        })) as typeof fetch;
        await assert.rejects(
            probeFreeDungeonServer("Rill", 41, "probeconflict123"),
            (error) => error instanceof DungeonProbeError && error.retryable === false && error.status === 409,
        );

        globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
        await assert.rejects(
            probeFreeDungeonServer("Rill", 41, "probeoffline123"),
            (error) => error instanceof DungeonProbeError && error.retryable === true,
        );
    } finally {
        globalThis.fetch = realFetch;
    }
});

test("World recovery advances an authoritative cross-device miss into the pet stage", () => {
    const worldMap = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");
    const recover = worldMap.slice(
        worldMap.indexOf("async function recoverPendingExternalDiscovery"),
        worldMap.indexOf("async function recoverPendingWorldRewards"),
    );
    assert.match(recover, /if \(!probe\.found\)[\s\S]{0,360}probe\.sector, "pet", undefined, probe\.requestId/);
    assert.match(recover, /continueWorldDiscovery\(next, false, reportFailure\)/,
        "an older unresolved miss must continue at its sealed sector/id instead of deadlocking the new device");
});

function jsonReply(body: Record<string, unknown>, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function validProbe(requestId = 'recoveryprobe01'): Record<string, unknown> {
    return { requestId, found: false, token: '', sector: 33, character: { name: 'Rill' }, _saveVersion: 21 };
}

async function withProbeReplies(replies: Array<Response | Error>, run: (bodies: Record<string, unknown>[]) => Promise<void>) {
    const realFetch = globalThis.fetch;
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        const response = replies.shift();
        if (response instanceof Error) throw response;
        return response ?? jsonReply({ error: 'Unexpected extra request.' }, 503);
    }) as typeof fetch;
    try { await run(bodies); } finally { globalThis.fetch = realFetch; }
}

test('overlapping dungeon probes share the entire exact-id retry sequence', { concurrency: false }, async () => {
    await withProbeReplies([jsonReply({ error: 'busy', reason: 'busy' }, 503), jsonReply(validProbe())], async (bodies) => {
        const [first, second] = await Promise.all([
            probeFreeDungeonServer('Rill', 33, 'recoveryprobe01'),
            probeFreeDungeonServer('Rill', 33, 'recoveryprobe01'),
        ]);
        assert.deepEqual(first, second);
        assert.equal(bodies.length, 2, 'two callers share one initial request plus one retry');
        assert.deepEqual(bodies, Array.from({ length: 2 }, () => ({
            playerName: 'Rill', action: 'probe-free', sector: 33, requestId: 'recoveryprobe01',
        })));
    });
});

test('lost dungeon acknowledgement recovers the same sealed result', { concurrency: false }, async () => {
    await withProbeReplies([new Error('lost response'), jsonReply({ ...validProbe(), found: true, token: 'sealedtoken01' })], async (bodies) => {
        const recovered = await probeFreeDungeonServer('Rill', 61, 'recoveryprobe01');
        assert.equal(recovered.token, 'sealedtoken01');
        assert.equal(recovered.sector, 33);
        assert.deepEqual(bodies[0], bodies[1], 'recovery cannot mint another discovery ID');
    });
});

test('presence startup, including older server responses, recovers without retiring a discovery', { concurrency: false }, async () => {
    for (const data of [
        { error: 'Your world presence is not ready — give it a moment and try again.', reason: 'no-presence' },
        { error: 'Your world presence is not ready — give it a moment and try again.' },
    ]) {
        await withProbeReplies([jsonReply(data, 409), jsonReply(validProbe())], async (bodies) => {
            assert.equal((await probeFreeDungeonServer('Rill', 33, 'recoveryprobe01')).found, false);
            assert.equal(bodies.length, 2);
        });
    }
});

test('incomplete dungeon replies are retried instead of becoming authoritative misses', { concurrency: false }, async () => {
    const complete = validProbe();
    for (const incomplete of [
        { ...complete, requestId: undefined },
        { ...complete, sector: undefined },
        { ...complete, sector: 67 },
        { ...complete, found: undefined },
        { ...complete, found: true, token: '' },
        { ...complete, worldExploreRequestId: 'bad' },
    ]) {
        await withProbeReplies([jsonReply(incomplete), jsonReply(complete)], async (bodies) => {
            assert.equal((await probeFreeDungeonServer('Rill', 33, 'recoveryprobe01')).found, false);
            assert.equal(bodies.length, 2, 'an incomplete result must not advance the discovery stage');
        });
    }
});

test('malformed JSON recovers and exhausted retries remain pending with a useful message', { concurrency: false }, async () => {
    await withProbeReplies([new Response('invalid JSON'), jsonReply(validProbe())], async (bodies) => {
        assert.equal((await probeFreeDungeonServer('Rill', 33, 'recoveryprobe01')).found, false);
        assert.equal(bodies.length, 2);
    });
    await withProbeReplies(Array.from({ length: 3 }, () => jsonReply({ error: 'Temporary outage.' }, 503)), async (bodies) => {
        await assert.rejects(probeFreeDungeonServer('Rill', 33, 'recoveryprobe01'), (error) => {
            assert.ok(error instanceof DungeonProbeError && error.retryable);
            assert.match(dungeonProbeFailureMessage(error), /Temporary outage.*saved attempt will be reused/);
            return true;
        });
        assert.equal(bodies.length, 3);
    });
    await withProbeReplies([jsonReply(validProbe())], async (bodies) => {
        await probeFreeDungeonServer('Rill', 33, 'recoveryprobe01');
        assert.equal(bodies.length, 1, 'failed single-flight entries are released for a later recovery');
    });
});

test('session and rate-limit refusals retain a receipt without automatic requests', { concurrency: false }, async () => {
    for (const status of [401, 429]) {
        await withProbeReplies([jsonReply({ error: 'Refused.' }, status)], async (bodies) => {
            await assert.rejects(probeFreeDungeonServer('Rill', 33, 'recoveryprobe01'), (error) => {
                assert.ok(error instanceof DungeonProbeError && error.retryable);
                assert.equal(error.status, status);
                assert.match(dungeonProbeFailureMessage(error), status === 401 ? /Sign in again/ : /Too many exploration requests/);
                return true;
            });
            assert.equal(bodies.length, 1);
        });
    }
});

test('daily cap and definitive sector conflicts stop with accurate explanations', { concurrency: false }, async () => {
    for (const failure of [
        { error: 'Daily hidden-dungeon search limit reached.', reason: 'daily-limit', message: /150\/150.*midnight UTC/ },
        { error: 'You are not in that sector.', reason: 'sector-mismatch', message: /You are not in that sector/ },
    ]) {
        await withProbeReplies([jsonReply({ error: failure.error, reason: failure.reason }, 409)], async (bodies) => {
            await assert.rejects(probeFreeDungeonServer('Rill', 33, 'recoveryprobe01'), (error) => {
                assert.ok(error instanceof DungeonProbeError && !error.retryable);
                assert.equal(error.reason, failure.reason);
                assert.match(dungeonProbeFailureMessage(error), failure.message);
                return true;
            });
            assert.equal(bodies.length, 1);
        });
    }
});
