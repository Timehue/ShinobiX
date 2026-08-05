import { strict as assert } from "node:assert";
import test from "node:test";
import type { SoloPveSession } from "./solo-pve-api";
import { soloPveArenaTransport, soloPveSessionForArena } from "./solo-pve-arena-adapter";

function session(): SoloPveSession {
    const fighter = (name: string, pos: number) => ({
        name, hp: 100, maxHp: 100, chakra: 80, maxChakra: 80,
        stamina: 70, maxStamina: 70, shield: 0, statuses: [],
        character: { name, jutsu: [], pvpItems: [] }, pos,
    });
    return {
        runtime: "solo-pve", schemaVersion: 1, sessionId: "solo-1", ownerSlug: "Player",
        encounter: { kind: "generic-ai", id: "bandit" },
        player: fighter("Player", 62), enemy: fighter("Bandit", 33),
        round: 2, activeSide: "player", ap: { player: 70, enemy: 100 }, actionsThisTurn: 1,
        cooldowns: { player: { j1: 2 }, enemy: {} }, groundEffects: [],
        itemCharges: { kunai: 2 }, itemsUsed: {},
        environment: { biome: "forest", blockedTiles: [5] },
        status: "active", winner: null, outcome: null, settlementState: "pending",
        log: ["Battle started."], events: [], eventSeq: 0, version: 7,
        createdAt: 1, lastActionAt: 1, expiresAt: 99_999, recentMoveTokens: [],
    };
}

test("solo session maps into the runtime-neutral normal Arena view", () => {
    const view = soloPveSessionForArena(session());
    assert.equal(view.sessionId, "solo-1");
    assert.equal(view.runtimeVersion, 7);
    assert.equal(view.activeAp, 70);
    assert.equal(view.actors.find((actor) => actor.id === "player")?.itemCharges?.kunai, 2);
    assert.deepEqual(view.map, { width: 12, height: 10, biome: "forest", blockedTiles: [5] });
});

test("a lost response retries the same versioned intent token", async () => {
    const originalFetch = globalThis.fetch;
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        if (bodies.length === 1) throw new Error("response lost");
        return new Response(JSON.stringify({ applied: true, session: session() }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    }) as typeof fetch;
    try {
        const current = soloPveSessionForArena(session());
        const result = await soloPveArenaTransport.submitAction("solo-1", "Player", current, { type: "attack", targetId: "enemy" });
        assert.equal(result.applied, true);
        assert.equal(bodies.length, 2);
        assert.equal(bodies[0]?.moveToken, bodies[1]?.moveToken);
        assert.equal(bodies[0]?.expectedVersion, 7);
        assert.equal(bodies[0]?.type, "basicAttack");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("probabilistic flee and deterministic forfeit use distinct server actions", async () => {
    const originalFetch = globalThis.fetch;
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        const next = session();
        next.version += 1;
        if (bodies.at(-1)?.type === "abandon") {
            next.status = "done";
            next.winner = "enemy";
            next.outcome = "loss";
        }
        return new Response(JSON.stringify({ applied: true, session: next }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    }) as typeof fetch;
    try {
        const current = soloPveSessionForArena(session());
        await soloPveArenaTransport.submitAction("solo-1", "Player", current, { type: "flee" });
        await soloPveArenaTransport.forfeit!("solo-1", "Player", current);
        assert.equal(bodies[0]?.type, "flee");
        assert.equal(bodies[1]?.type, "abandon");
    } finally {
        globalThis.fetch = originalFetch;
    }
});
