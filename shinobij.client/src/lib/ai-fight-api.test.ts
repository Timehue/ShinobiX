import assert from "node:assert/strict";
import test from "node:test";
import {
    recoverPendingWorldOutcome,
    resumeGenericAiFight,
    resumeWorldAiFight,
    startAiFight,
} from "./ai-fight-api";
import { rollOrdinaryPveEncounter } from '../../../shared/ordinary-pve-encounter';

test('start and both resume lanes retain the server-sealed descriptor and only send its id', { concurrency: false }, async () => {
    const encounter = rollOrdinaryPveEncounter({ sourceId: 'receipt_123456', playerLevel: 75, sector: 66, displayName: 'Tsukika the Quiet Blade' });
    const generic = { token: 'token', sessionId: 'session', session, opponentId: encounter.profileId, opponentName: encounter.displayName,
        battleKind: 'explore', encounter, worldExploreRequestId: 'receipt_123456', sector: 66 };
    const worldContext = { kind: 'wanderer', sourceId: 'w-66-5000-2', sector: 66, stage: 0, displayName: encounter.displayName, encounter };
    const replies = [response(generic), response(generic), response({ ...generic, worldContext })];
    const previous = globalThis.fetch;
    const requests: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => { requests.push(JSON.parse(String(init.body))); return replies.shift()!; }) as typeof fetch;
    try {
        const started = await startAiFight({ playerName: 'Rill', opponentId: encounter.profileId, opponentLevel: encounter.level,
            battleKind: 'explore', sector: 66, worldExploreRequestId: 'receipt_123456', encounterId: encounter.id });
        assert.ok('encounter' in started);
        assert.deepEqual(started.encounter, encounter);
        assert.deepEqual((await resumeGenericAiFight('Rill'))?.encounter, encounter);
        const world = await resumeWorldAiFight('Rill');
        assert.ok(world && 'worldContext' in world);
        assert.deepEqual(world.worldContext?.encounter, encounter);
        assert.equal(requests[0].encounterId, encounter.id);
        assert.equal('encounter' in requests[0], false, 'the body cannot supply a replacement descriptor');
    } finally { globalThis.fetch = previous; }
});

const session = {
    runtime: "solo-pve",
    enemy: { character: { level: 20 } },
} as never;

test('only an Arena practice request sends the explicit selected level; resume stays server-owned', { concurrency: false }, async () => {
    const previous = globalThis.fetch;
    const requests: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        return response({ token: 'token', sessionId: 'session', session, opponentId: 'builtin-ai-central-champion', opponentName: 'Central Champion', battleKind: 'practice' });
    }) as typeof fetch;
    try {
        for (const battleKind of ['practice', 'explore', 'raidAi', 'dungeon'] as const) {
            await startAiFight({ playerName: 'Rill', opponentId: 'builtin-ai-central-champion', opponentLevel: 100, practiceLevel: 100, battleKind });
        }
        assert.equal(requests[0].practiceLevel, 100);
        for (const request of requests.slice(1)) assert.equal('practiceLevel' in request, false);
        await resumeGenericAiFight('Rill');
        assert.deepEqual(requests.at(-1), { playerName: 'Rill', resumeAiFight: true, recoveryProbeVersion: 2 });
    } finally { globalThis.fetch = previous; }
});

function response(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    } as Response;
}

test('an explicitly resumable 503 adopts its sealed World fight without retrying the start', { concurrency: false }, async () => {
    const worldContext = { kind: 'wanderer-ambush', sourceId: 'wanderer-ambush', sector: 60, stage: 3, chainId: 'saved_chain', displayName: 'Road Bandit' };
    const sealed = { token: 'sealed-token', sessionId: 'sealed-session', session, worldContext, resumed: true };
    const replies = [response({ error: 'World encounter start is still finalizing.', resumable: true }, 503), response(sealed)];
    const requests: Record<string, unknown>[] = [];
    const previous = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        return replies.shift()!;
    }) as typeof fetch;
    try {
        const result = await startAiFight({ playerName: 'Rill', opponentId: worldContext.sourceId, opponentLevel: 20, battleKind: 'world', worldEncounter: worldContext as never });
        assert.equal('sessionId' in result && result.sessionId, sealed.sessionId);
        assert.equal(requests.length, 2);
        assert.equal(requests[1].resumeWorldFight, true);
    } finally { globalThis.fetch = previous; }
});

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
            { playerName: "Rill", resumeWorldFight: true, recoveryProbeVersion: 2 },
            { playerName: "Rill", resumeWorldFight: true, recoveryProbeVersion: 2 },
            { playerName: "Rill", resumeAiFight: true, recoveryProbeVersion: 2 },
        ]);
        assert.deepEqual(bodies[3], { action: "claim", playerName: "Rill" });
    } finally {
        globalThis.fetch = realFetch;
    }
});

test("resume probes treat current 204 and legacy 404 missing-pointer responses as normal", { concurrency: false }, async () => {
    const realFetch = globalThis.fetch;
    try {
        globalThis.fetch = (async () => response(undefined, 204)) as typeof fetch;
        assert.equal(await resumeWorldAiFight("Rill"), null);
        assert.equal(await resumeGenericAiFight("Rill"), null);
        globalThis.fetch = (async () => response({ error: "none" }, 404)) as typeof fetch;
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
        assert.deepEqual(bodies[1], { playerName: "Rill", resumeAiFight: true, recoveryProbeVersion: 2 });
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
        assert.deepEqual(bodies[1], { playerName: "Rill", resumeWorldFight: true, recoveryProbeVersion: 2 });
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
