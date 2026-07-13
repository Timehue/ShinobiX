import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVaultInterior, VAULT_DIMS } from "./vault-interior";
import { findHollowGatePath } from "../../lib/hollow-gate-path";
import type { HollowGateShrineRun } from "../../types/character";

/*
 * The generation contract the raid is unwinnable without: at the vault's small
 * dims the generator must place EXACTLY the content we expect — a boss (vault)
 * tile reachable from the spawn — with all Hollow Gate content stripped and
 * every room stamped 'warvault'. Generation is random per call, so each check
 * runs across many builds to catch layout-dependent failures.
 */

const RUNS = 60;

function fullKnown(run: HollowGateShrineRun): Set<number> {
    return new Set(run.tiles.map((_, i) => i));
}

test("vault interior: a vault (boss) tile always exists and is REACHABLE from spawn", () => {
    for (let i = 0; i < RUNS; i++) {
        const run = buildVaultInterior();
        const bossIdx = run.tiles.findIndex(t => t.kind === "boss");
        assert.ok(bossIdx >= 0, `build ${i}: no vault tile`);
        const path = findHollowGatePath(run, bossIdx, fullKnown(run));
        assert.ok(path && path.length > 0, `build ${i}: vault unreachable from spawn`);
    }
});

test("vault interior: all Hollow Gate content is stripped (walls + ONE vault only)", () => {
    for (let i = 0; i < RUNS; i++) {
        const run = buildVaultInterior();
        const kinds = new Set(run.tiles.map(t => t.kind));
        for (const k of kinds) {
            assert.ok(["empty", "wall", "boss"].includes(k), `build ${i}: leaked HG content kind "${k}"`);
        }
        assert.equal(run.tiles.filter(t => t.kind === "boss").length, 1, `build ${i}: expected exactly one vault`);
    }
});

test("vault interior: every room is themed 'warvault'; dims + spawn are sane", () => {
    for (let i = 0; i < RUNS; i++) {
        const run = buildVaultInterior() as HollowGateShrineRun & { roomThemes?: Record<number, string> };
        assert.equal(run.width, VAULT_DIMS.width);
        assert.equal(run.height, VAULT_DIMS.height);
        const roomIds = new Set(run.tiles.map(t => t.roomId).filter((r): r is number => r != null));
        assert.ok(roomIds.size > 0, `build ${i}: no rooms generated`);
        for (const id of roomIds) {
            assert.equal(run.roomThemes?.[id], "warvault", `build ${i}: room ${id} not themed`);
        }
        const spawn = run.tiles[run.playerY * run.width + run.playerX];
        assert.ok(spawn && spawn.kind !== "wall", `build ${i}: spawn inside a wall`);
    }
});
