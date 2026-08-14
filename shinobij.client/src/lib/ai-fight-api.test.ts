import assert from "node:assert/strict";
import test from "node:test";
import {
    recoverPendingWorldOutcome,
    resumeGenericAiFight,
    resumeWorldAiFight,
    startAiFight,
} from "./ai-fight-api";

const session = {
    runtime: "solo-pve",
    enemy: { character: { level: 20 } },
} as never;

function response(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    } as Response;
}

test("AI fight API preserves sealed resume identity and durable handoffs", { concurrency: false }, async () => {
    const realFetch = globalThis.fetch;
    const bodies: Record<string, unknown>[] = [];
    const replies = [
        response({
            ok: true,
            resumed: true,
            pendingWorldChain: {
                request: { kind: "hunt-pack", sourceId: "hunt-wolf", sector: 61, stage: 2, chainId: "chain_12345678", decisionId: "decision_123" },
                displayName: "Frost Wolf Pack — Wave 3",
                createdAt: 10,
            },
        }),
        response({
            ok: true,
            resumed: true,
            pendingWorldOutcome: {
                kind: "wanderer-ambush-reward",
                claimId: "ambush:chain_12345678:61",
                chainId: "chain_12345678",
                sourceId: "wanderer-ambush",
                sector: 61,
                createdAt: 20,
                action: "claim",
                endpoint: "/api/sector/wanderer-ambush",
            },
        }),
        response({
            ok: true,
            token: "token123456",
            sessionId: "aifight-session123",
            session,
            resumed: true,
            opponentId: "builtin-ai-guard",
            opponentName: "Village Guard",
            battleKind: "raidAi",
            sector: 66,
        }),
        response({
            ok: true,
            replayed: true,
            reward: { ryo: 75, fateShards: 1, boneCharms: 0 },
            character: { name: "Rill", ryo: 500 },
            _saveVersion: 42,
        }),
        response({
            ok: true,
            token: "token654321",
            sessionId: "aifight-session456",
            session,
            opponentId: "builtin-ai-bandit",
            opponentName: "Bandit",
            battleKind: "explore",
            sector: 61,
        }),
    ];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return replies.shift()!;
    }) as typeof fetch;

    try {
        const chain = await resumeWorldAiFight("Rill");
        assert.ok(chain && "pendingWorldChain" in chain);
        assert.deepEqual(chain.pendingWorldChain.request, {
            kind: "hunt-pack", sourceId: "hunt-wolf", sector: 61, stage: 2,
            chainId: "chain_12345678", decisionId: "decision_123",
        });

        const pending = await resumeWorldAiFight("Rill");
        assert.ok(pending && "pendingWorldOutcome" in pending);

        const generic = await resumeGenericAiFight("Rill");
        assert.equal(generic?.battleKind, "raidAi");
        assert.equal(generic?.opponentId, "builtin-ai-guard");
        assert.equal(generic?.sector, 66);

        const claimed = await recoverPendingWorldOutcome("Rill", pending.pendingWorldOutcome);
        assert.equal(claimed.character.name, "Rill");
        assert.equal(claimed._saveVersion, 42);

        await startAiFight({
            playerName: "Rill",
            opponentId: "builtin-ai-bandit",
            opponentLevel: 20,
            battleKind: "explore",
            sector: 61,
            worldExploreRequestId: "explore_receipt_123",
            raidToken: "raid_proof_123",
        });
        assert.equal(bodies[4].sector, 61);
        assert.equal(bodies[4].worldExploreRequestId, "explore_receipt_123");
        assert.equal(bodies[4].raidToken, "raid_proof_123");
        assert.deepEqual(bodies.slice(0, 3), [
            { playerName: "Rill", resumeWorldFight: true },
            { playerName: "Rill", resumeWorldFight: true },
            { playerName: "Rill", resumeAiFight: true },
        ]);
        assert.deepEqual(bodies[3], { action: "claim", playerName: "Rill" });
    } finally {
        globalThis.fetch = realFetch;
    }
});

test("resume probes treat a missing pointer as normal", { concurrency: false }, async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => response({ error: "none" }, 404)) as typeof fetch;
    try {
        assert.equal(await resumeWorldAiFight("Rill"), null);
        assert.equal(await resumeGenericAiFight("Rill"), null);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test("World resume hands an active generic pointer to generic recovery", { concurrency: false }, async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => response({ error: "generic-active", mode: "generic" }, 409)) as typeof fetch;
    try {
        assert.equal(await resumeWorldAiFight("Rill"), null);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test("a lost generic start ACK resumes the sealed pointer immediately", { concurrency: false }, async () => {
    const realFetch = globalThis.fetch;
    const bodies: Record<string, unknown>[] = [];
    const replies = [
        response({ error: "An AI encounter is already active.", resumable: true, sessionId: "session-existing" }, 409),
        response({
            ok: true,
            resumed: true,
            token: "token-existing",
            sessionId: "session-existing",
            session,
            opponentId: "server-derived-bandit",
            opponentName: "Sealed Bandit",
            battleKind: "explore",
            sector: 61,
            worldExploreRequestId: "explore_receipt_existing",
        }),
    ];
    globalThis.fetch = (async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return replies.shift()!;
    }) as typeof fetch;
    try {
        const started = await startAiFight({
            playerName: "Rill",
            opponentId: "client-suggestion",
            opponentLevel: 20,
            battleKind: "explore",
            sector: 61,
            worldExploreRequestId: "explore_receipt_existing",
        });
        assert.equal(started.resumed, true);
        assert.equal(started.opponentId, "server-derived-bandit");
        assert.deepEqual(bodies[1], { playerName: "Rill", resumeAiFight: true });
    } finally {
        globalThis.fetch = realFetch;
    }
});

test("a lost World start ACK recovers the sealed active fight without reload", { concurrency: false }, async () => {
    const realFetch = globalThis.fetch;
    const bodies: Record<string, unknown>[] = [];
    let attempt = 0;
    globalThis.fetch = (async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        attempt += 1;
        if (attempt === 1) throw new Error("lost start ACK");
        return response({
            ok: true,
            resumed: true,
            token: "world-token-existing",
            sessionId: "world-session-existing",
            session,
            worldContext: {
                kind: "wanderer",
                sourceId: "wanderer-44",
                sector: 44,
                stage: 0,
                displayName: "Scarred Wanderer",
            },
        });
    }) as typeof fetch;
    try {
        const started = await startAiFight({
            playerName: "Rill",
            opponentId: "client-placeholder",
            opponentLevel: 20,
            battleKind: "world",
            worldEncounter: { kind: "wanderer", sourceId: "wanderer-44", sector: 44 },
        });
        assert.ok("worldContext" in started);
        if ("worldContext" in started) assert.equal(started.worldContext?.sourceId, "wanderer-44");
        assert.deepEqual(bodies[1], { playerName: "Rill", resumeWorldFight: true });
    } finally {
        globalThis.fetch = realFetch;
    }
});

test("a lost chain-start ACK returns the durable next-wave handoff", { concurrency: false }, async () => {
    const realFetch = globalThis.fetch;
    let attempt = 0;
    globalThis.fetch = (async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("lost chain ACK");
        return response({
            ok: true,
            resumed: true,
            pendingWorldChain: {
                request: { kind: "wanderer-ambush", sourceId: "wanderer-ambush", sector: 44, stage: 2, chainId: "chain_12345678" },
                displayName: "Ambushers — Wave 3",
                createdAt: 30,
            },
        });
    }) as typeof fetch;
    try {
        const recovered = await startAiFight({
            playerName: "Rill",
            opponentId: "ambusher",
            opponentLevel: 20,
            battleKind: "world",
            worldEncounter: { kind: "wanderer-ambush", sourceId: "wanderer-ambush", sector: 44, stage: 2, chainId: "chain_12345678" },
        });
        assert.ok("pendingWorldChain" in recovered);
        if ("pendingWorldChain" in recovered) assert.equal(recovered.pendingWorldChain.request.stage, 2);
    } finally {
        globalThis.fetch = realFetch;
    }
});
