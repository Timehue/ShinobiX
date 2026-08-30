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
    assert.equal(view.companionUsed, false);
});

test("the Arena view carries the server's VFX plates through, tagged by event seq", () => {
    const source = session();
    source.eventSeq = 12;
    source.events = [
        {
            kind: "action", seq: 11, round: 2, actor: "player", target: "enemy", action: "jutsu",
            before: {} as never, after: {} as never, log: [],
            vfx: [{ key: "fireball", target: "enemy", anchor: "target", tiles: [33, 34] }],
            status: "active", winner: null, outcome: null,
        },
        {
            kind: "action", seq: 12, round: 2, actor: "enemy", target: "player", action: "basicAttack",
            before: {} as never, after: {} as never, log: [],
            vfx: [{ key: "impact", target: "player", anchor: "target" }],
            status: "active", winner: null, outcome: null,
        },
    ] as never;

    const view = soloPveSessionForArena(source);
    assert.equal(view.vfxSeq, 12, "the view must expose the server's newest event seq");
    assert.deepEqual(view.vfx, [
        { seq: 11, key: "fireball", target: "enemy", anchor: "target", tiles: [33, 34] },
        { seq: 12, key: "impact", target: "player", anchor: "target" },
    ]);
    // A plate's target must be an ACTOR ID in the projected view, or the screen
    // cannot anchor it to a fighter's tile.
    const actorIds = new Set(view.actors.map((actor) => actor.id));
    for (const plate of view.vfx ?? []) assert.ok(actorIds.has(plate.target), `${plate.target} is not an actor id`);
});

test("a fight with no VFX yet still projects an empty stream rather than undefined", () => {
    const view = soloPveSessionForArena(session());
    assert.deepEqual(view.vfx, []);
    assert.equal(view.vfxSeq, 0);
});

test("the Arena view preserves every authoritative enemy movement step", () => {
    const source = session();
    source.eventSeq = 14;
    source.enemy.pos = 43;
    source.events = [
        {
            kind: "action", seq: 12, round: 2, actor: "player", target: "enemy", action: "basicAttack",
            before: { player: { pos: 62 }, enemy: { pos: 33 } } as never,
            after: { player: { pos: 62 }, enemy: { pos: 33 } } as never,
            log: [], vfx: [], status: "active", winner: null, outcome: null,
        },
        {
            kind: "action", seq: 13, round: 2, actor: "enemy", target: "tile", action: "move", tile: 44,
            before: { player: { pos: 62 }, enemy: { pos: 33 } } as never,
            after: { player: { pos: 62 }, enemy: { pos: 44 } } as never,
            log: [], vfx: [], status: "active", winner: null, outcome: null,
        },
        {
            kind: "action", seq: 14, round: 2, actor: "enemy", target: "tile", action: "move", tile: 43,
            before: { player: { pos: 62 }, enemy: { pos: 44 } } as never,
            after: { player: { pos: 62 }, enemy: { pos: 43 } } as never,
            log: [], vfx: [], status: "active", winner: null, outcome: null,
        },
    ];

    const view = soloPveSessionForArena(source);
    assert.equal(view.movementSeq, 14);
    assert.deepEqual(view.movements, [
        { seq: 13, actorId: "enemy", from: 33, to: 44 },
        { seq: 14, actorId: "enemy", from: 44, to: 43 },
    ]);
});

test("the Arena view preserves whether the one-time PvE pet summon was consumed", () => {
    const source = session();
    source.companionUsage = { petId: "pet-1" };
    assert.equal(soloPveSessionForArena(source).companionUsed, true);
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

test("the shared PvE Flee control submits the server-owned probabilistic action", async () => {
    const originalFetch = globalThis.fetch;
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        const next = session();
        next.version += 1;
        return new Response(JSON.stringify({ applied: true, session: next }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    }) as typeof fetch;
    try {
        const current = soloPveSessionForArena(session());
        await soloPveArenaTransport.submitAction("solo-1", "Player", current, { type: "flee" });
        assert.equal(bodies[0]?.type, "flee");
        assert.equal(bodies.length, 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
