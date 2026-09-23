import { test } from "node:test";
import assert from "node:assert/strict";
import type { HollowGateShrineRun } from "../types/character";
import { sealHollowGateFloor } from "./hollow-gate-event-api";
import { sealHollowGateStep } from "./hollow-gate-step-api";
import { resolveHollowGateTile, type HollowGateEventModal } from "./hollow-gate-tile";

test("floor reconciliation returns the server's pending ambush after a refresh", async () => {
    const originalFetch = globalThis.fetch;
    const pendingAmbush = { nodeId: "floor:2:ambush:threat-v25", kind: "ambush" };
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, pendingAmbush, position: { x: 3, y: 4 } }), { status: 200 })) as typeof fetch;
    try {
        const run = { floor: 2, width: 15, height: 11, playerX: 1, playerY: 1, tiles: [] } as unknown as HollowGateShrineRun;
        const result = await sealHollowGateFloor("shinobi", "token", run);
        assert.deepEqual(result.pendingAmbush, pendingAmbush);
        assert.deepEqual(result.position, { x: 3, y: 4 });
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("rejected movement returns the active fight pointer and server position", async () => {
    const originalFetch = globalThis.fetch;
    const activeCombat = { runId: "fight-1", nodeId: "floor:2:tile:20", floor: 2, kind: "battle", mode: "pve" };
    globalThis.fetch = (async () => new Response(JSON.stringify({
        error: "Resolve the sealed encounter before moving.",
        position: { x: 3, y: 4 }, activeCombat,
    }), { status: 409 })) as typeof fetch;
    try {
        const result = await sealHollowGateStep({
            playerName: "shinobi", token: "token", requestId: "step-test-1",
            fromX: 3, fromY: 4, toX: 4, toY: 4,
        });
        assert.equal(result.ok, false);
        assert.deepEqual(result.position, { x: 3, y: 4 });
        assert.deepEqual(result.activeCombat, activeCombat);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("tile resolution waits for the server reward before an ambush may open", async () => {
    const originalFetch = globalThis.fetch;
    let respond: ((response: Response) => void) | undefined;
    globalThis.fetch = (async () => new Promise<Response>((resolve) => { respond = resolve; })) as typeof fetch;
    try {
        const tile = { kind: "chest", terrain: "room_floor" } as HollowGateShrineRun["tiles"][number];
        let run = { floor: 1, width: 15, height: 11, playerX: 2, playerY: 1,
            runToken: "token", keys: 0, torch: 4, tiles: Array.from({ length: 165 }, () => tile),
        } as HollowGateShrineRun;
        let modal: HollowGateEventModal = null;
        const pending = resolveHollowGateTile(tile, 2, 1, {
            character: { name: "shinobi" } as never,
            hollowGateRun: run,
            setHollowGateRun: (value) => { run = typeof value === "function" ? value(run)! : value!; },
            setHollowGateEvent: (value) => { modal = typeof value === "function" ? value(modal) : value; },
            setHollowGateHiddenChamber: () => undefined,
            onVersionedCharacter: () => true,
            pushHollowGateLog: () => undefined,
            buildHollowGateRunSummary: () => "",
            startHollowGateBattle: () => undefined,
            leaveHollowGateShrine: () => undefined,
        });
        assert.ok(pending instanceof Promise);
        assert.equal(modal, null);
        respond?.(new Response(JSON.stringify({ ok: true, reward: { currencies: { ryo: 5 } },
            runState: { keys: 0, torch: 5, threat: 0, secondWindArmed: false } }), { status: 200 }));
        await pending;
        assert.equal(modal?.title, "Shrine Offering Chest");
    } finally {
        globalThis.fetch = originalFetch;
    }
});
