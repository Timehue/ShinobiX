import { afterEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { HollowGateShrineRun, HollowGateTile } from "../types/character";
import { generateHollowGateShrineRun } from "./hollow-gate-dungeon";
import {
    fetchHollowGateResume,
    hollowGateBoardManifest,
    hollowGateBoardMatchesManifest,
    hollowGateResolvedTileIndex,
    hollowGateResumeVariant,
    rebuildHollowGateRun,
    recoverHollowGateRun,
    type HollowGateResumeState,
    type HollowGateSealedManifest,
} from "./hollow-gate-recovery";
import { computeHollowGateVisible } from "./hollow-gate-visibility";

/*
 * A reload mid-run drops the drawn board, because the save holds only the
 * server's projection. These pin the rebuild from the server's sealed run: the
 * same floor from the run's seed, every cleared tile, the path walked, the map
 * memory, the chosen augment and the open fight.
 */

const SEED = "recovery-seed-7f3a";
const OFFERS = [
    { id: "keen-edge", label: "Keen Edge", description: "", rarity: "common" as const },
    { id: "greedy-pact", label: "Greedy Pact", description: "", rarity: "rare" as const, riskLabel: "Enemies +30% power" },
];

function sealed(run: HollowGateShrineRun, floor: number): HollowGateSealedManifest {
    return { floor, width: run.width, height: run.height, spawn: { x: run.playerX, y: run.playerY }, ...hollowGateBoardManifest(run.tiles) };
}
const indexOfKind = (run: HollowGateShrineRun, kind: string, skip = 0) =>
    run.tiles.map((tile, index) => (tile.kind === kind ? index : -1)).filter((index) => index >= 0)[skip];
const walkableEmpty = (run: HollowGateShrineRun) =>
    run.tiles.map((tile, index) => (tile.kind === "empty" && tile.terrain !== "wall" && index !== run.playerY * run.width + run.playerX ? index : -1))
        .filter((index) => index >= 0);
function mask(size: number, indices: number[]): string {
    const bits = Array.from({ length: size }, () => "0");
    for (const index of indices) bits[index] = "1";
    return bits.join("");
}
function state(overrides: Partial<HollowGateResumeState> = {}): HollowGateResumeState {
    return {
        token: "token-live", seed: SEED, floorDepth: 5, floor: 3,
        chosenAugmentId: "greedy-pact", augmentOffers: OFFERS,
        position: null, keys: 2, torch: 6, threat: 28, wardSteps: 1, divinerUsed: false, secondWindArmed: true,
        resolvedEncounterIds: [], resolvedEventIds: [], visited: null, manifest: null,
        activeCombat: null, pendingAmbush: null, entryCurrencies: { ryo: 500 },
        ...overrides,
    };
}

describe("hollow gate recovery — the board is the one the run sealed", () => {
    it("the seeded generator redraws the same floor, which is what recovery rests on", () => {
        const a = generateHollowGateShrineRun(3, undefined, SEED);
        const b = generateHollowGateShrineRun(3, undefined, SEED);
        assert.deepEqual(sealed(a, 3), sealed(b, 3));
        assert.equal(hollowGateBoardMatchesManifest(b, sealed(a, 3)), true);
        const other = generateHollowGateShrineRun(3, undefined, "a-different-seed");
        assert.equal(hollowGateBoardMatchesManifest(other, sealed(a, 3)), false);
    });

    it("parses resolved encounter and event ids to their tile on this floor only", () => {
        assert.equal(hollowGateResolvedTileIndex("3:battle:floor:3:tile:57", 3), 57);
        assert.equal(hollowGateResolvedTileIndex("3:beast:floor:3:tile:8", 3), 8);
        assert.equal(hollowGateResolvedTileIndex("event:3:shard-vein:floor:3:tile:91", 3), 91);
        assert.equal(hollowGateResolvedTileIndex("event:3:keeper:floor:3:tile:4", 3), 4);
        assert.equal(hollowGateResolvedTileIndex("2:battle:floor:2:tile:57", 3), -1, "another floor");
        assert.equal(hollowGateResolvedTileIndex("3:ambush:floor:3:ambush:threat-v9", 3), -1, "an ambush has no tile");
        assert.equal(hollowGateResolvedTileIndex("3:card:floor:3:ambush:threat-v2", 3), -1);
    });

    it("rebuilds cleared tiles, the walked path, map memory, position, augment and the open fight", () => {
        const generated = generateHollowGateShrineRun(3, undefined, SEED);
        const manifest = sealed(generated, 3);
        const battle = indexOfKind(generated, "battle");
        const withdrawn = indexOfKind(generated, "battle", 1);
        const chest = indexOfKind(generated, "chest");
        const spawn = generated.playerY * generated.width + generated.playerX;
        const here = walkableEmpty(generated)[0];
        const pet = { runId: "hgcombat-live", nodeId: `floor:3:tile:${withdrawn}`, floor: 3, kind: "battle" as const, mode: "pet" as const };
        const run = rebuildHollowGateRun(state({
            manifest,
            position: { x: here % generated.width, y: Math.floor(here / generated.width) },
            visited: mask(generated.tiles.length, [spawn, battle, here]),
            resolvedEncounterIds: [`3:battle:floor:3:tile:${battle}`, `2:battle:floor:2:tile:${chest}`, "3:ambush:floor:3:ambush:threat-v9"],
            resolvedEventIds: [`event:3:chest:floor:3:tile:${chest}`],
            activeCombat: pet,
        }), generated);

        assert.equal(run.floor, 3);
        assert.equal(run.width, generated.width);
        assert.deepEqual(run.tiles.map((tile) => [tile.kind, tile.terrain]), generated.tiles.map((tile) => [tile.kind, tile.terrain]), "the generated board, not a fallback");
        assert.equal(run.tiles[battle].resolved, true);
        assert.equal(run.tiles[chest].resolved, true);
        assert.equal(run.tiles[withdrawn].resolved, false, "a fight left alive stays open");
        assert.deepEqual([run.playerX, run.playerY], [here % generated.width, Math.floor(here / generated.width)]);
        for (const index of [spawn, battle, here]) assert.equal(run.tiles[index].revealed, true, `stepped on ${index}`);
        for (const index of [...computeHollowGateVisible({ ...generated, playerX: generated.playerX, playerY: generated.playerY })]) {
            assert.equal(run.tiles[index].seen, true, `the spawn's room is remembered (${index})`);
        }
        assert.equal(run.tiles.filter((tile) => tile.revealed).length >= 3, true);
        assert.deepEqual([run.keys, run.torch, run.threat, run.wardSteps, run.secondWindArmed], [2, 6, 28, 1, true]);
        assert.equal(run.chosenAugment?.id, "greedy-pact");
        assert.deepEqual(run.augmentOffers, OFFERS);
        assert.deepEqual(run.activeCombat, pet, "the duel keeps its mode");
        assert.equal(run.runToken, "token-live");
        assert.equal(run.serverSeed, SEED);
        assert.deepEqual(run.entryCurrencies, { ryo: 500 });
        assert.equal(run.completed, false);
        assert.equal(run.diviner, undefined);
    });

    it("a floor the generator no longer reproduces is rebuilt from the sealed manifest", () => {
        const generated = generateHollowGateShrineRun(2, undefined, SEED);
        const manifest = sealed(generated, 2);
        const battle = indexOfKind(generated, "battle");
        const tampered: HollowGateSealedManifest = { ...manifest, nodes: { ...manifest.nodes, [String(battle)]: "elite" } };
        const run = rebuildHollowGateRun(state({ floor: 2, manifest: tampered, position: tampered.spawn }), generated);
        assert.equal(run.tiles[battle].kind, "elite", "the sealed manifest wins");
        assert.equal(run.roomThemes, undefined);
        assert.deepEqual(hollowGateBoardManifest(run.tiles), { walkable: tampered.walkable, nodes: tampered.nodes }, "floor-seal will accept it unchanged");
        const wall = [...tampered.walkable].findIndex((bit) => bit === "0");
        assert.equal(run.tiles[wall].terrain, "wall");
        assert.equal(run.tiles.every((tile) => tile.terrain === "wall" || tile.terrain === "corridor_floor"), true);
        assert.deepEqual([run.playerX, run.playerY], [tampered.spawn.x, tampered.spawn.y]);
    });

    it("an unsealed floor (a reload right after a descend) stands at its spawn, ready to seal", () => {
        const generated = generateHollowGateShrineRun(4, undefined, SEED);
        const run = rebuildHollowGateRun(state({ floor: 4 }), generated);
        assert.deepEqual([run.playerX, run.playerY], [generated.playerX, generated.playerY]);
        assert.equal(run.tiles[generated.playerY * generated.width + generated.playerX].revealed, true);
        assert.equal(run.floor, 4);
    });

    it("a Diviner's Eye already used on this floor reveals the whole board again", () => {
        const generated = generateHollowGateShrineRun(1, undefined, SEED);
        const run = rebuildHollowGateRun(state({ floor: 1, divinerUsed: true }), generated);
        assert.equal(run.diviner, true);
        assert.equal(run.tiles.every((tile) => tile.revealed), true);
    });

    it("the detour a player already entered stays committed and the others stay sealed", () => {
        // 1×6 corridor: hub (0-1), trial wing 0 (2-3), treasure wing 1 (4), beast wing 2 (5).
        const tile = (wing?: number): HollowGateTile => ({ kind: "empty", terrain: "corridor_floor", roomId: null, revealed: false, resolved: false, ...(wing === undefined ? {} : { wing }) });
        const board: HollowGateShrineRun = {
            width: 6, height: 1, playerX: 0, playerY: 0, floor: 1, threat: 0, torch: 10, keys: 0, completed: false,
            tiles: [tile(), tile(), tile(0), tile(0), tile(1), tile(2)],
            wingThemes: { 0: "trial", 1: "treasure", 2: "beast" },
        };
        const entered = rebuildHollowGateRun(state({ floor: 1, visited: "110010", position: { x: 1, y: 0 } }), board);
        assert.equal(entered.committedDetour, 1);
        assert.deepEqual(entered.sealedWings, [2]);
        const trialOnly = rebuildHollowGateRun(state({ floor: 1, visited: "111100", position: { x: 3, y: 0 } }), board);
        assert.equal(trialOnly.committedDetour, null, "the trial wing never commits a detour");
        assert.deepEqual(trialOnly.sealedWings, []);
    });

    it("rebuilds an event gate on its own shape", () => {
        const live = state({ floor: 1, variantId: "event-festival", floorDepth: 2, floorWidth: 19, floorHeight: 13, bossName: "Lantern Oni" });
        const variant = hollowGateResumeVariant(live);
        assert.deepEqual(variant, { id: "event-festival", maxFloor: 2, width: 19, height: 13, bossAiId: undefined, bossName: "Lantern Oni" });
        const run = rebuildHollowGateRun(live, generateHollowGateShrineRun(1, variant, SEED), variant);
        assert.equal(run.width, 19);
        assert.equal(run.variant?.bossName, "Lantern Oni");
        assert.equal(hollowGateResumeVariant(state()), undefined);
    });
});

describe("hollow gate recovery — the flow never starts or spends anything", () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });
    const respond = (status: number, body: unknown) => {
        globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
    };
    function harness() {
        const calls: Record<string, unknown[]> = {};
        const record = (name: string) => (value: unknown) => { (calls[name] ??= []).push(value); };
        return {
            calls,
            params: {
                character: { name: "diver" } as never,
                setHollowGateRun: record("run") as never,
                setHollowGateLog: record("log") as never,
                setHollowGateEvent: record("event") as never,
                setHollowGateHiddenChamber: record("chamber") as never,
                setCharacter: record("character") as never,
                setCurrentBiome: record("biome") as never,
                setCurrentWeather: record("weather") as never,
                setScreen: record("screen") as never,
                pushHollowGateLog: record("push") as never,
            },
        };
    }

    it("reads live, gone and failed replies", async () => {
        respond(200, { ok: true, live: true, run: state() });
        assert.equal((await fetchHollowGateResume("diver")).kind, "live");
        respond(200, { ok: true, live: false });
        assert.equal((await fetchHollowGateResume("diver")).kind, "gone");
        respond(503, { error: "down" });
        assert.deepEqual(await fetchHollowGateResume("diver"), { kind: "error", error: "down" });
        globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
        assert.equal((await fetchHollowGateResume("diver")).kind, "error");
    });

    it("returns to the shrine with the rebuilt run, and offers an unchosen augment again", async () => {
        respond(200, { ok: true, live: true, run: state({ floor: 2, chosenAugmentId: null }) });
        const { calls, params } = harness();
        // The picker is browser-only (hollowGateServerEnabled checks for window).
        const global = globalThis as { window?: unknown };
        global.window = globalThis;
        try {
            assert.equal(await recoverHollowGateRun(params), "recovered");
        } finally {
            delete global.window;
        }
        assert.deepEqual(calls.screen, ["hollowGateShrine"]);
        const run = calls.run[0] as HollowGateShrineRun;
        assert.equal(run.floor, 2);
        assert.equal(run.runToken, "token-live");
        const picker = calls.event.find((event) => event && typeof event === "object") as { title?: string } | undefined;
        assert.equal(picker?.title, "Choose Your Hollow Gate Augment", "the still-open choice is offered again");
    });

    it("does not offer the picker again once the augment is chosen", async () => {
        respond(200, { ok: true, live: true, run: state({ floor: 2 }) });
        const { calls, params } = harness();
        const global = globalThis as { window?: unknown };
        global.window = globalThis;
        try {
            assert.equal(await recoverHollowGateRun(params), "recovered");
        } finally {
            delete global.window;
        }
        assert.deepEqual(calls.event, [null]);
    });

    it("leaves the player where they are when the run has ended or cannot be read", async () => {
        for (const reply of [[200, { ok: true, live: false }], [500, { error: "boom" }]] as const) {
            respond(reply[0], reply[1]);
            const { calls, params } = harness();
            const outcome = await recoverHollowGateRun(params);
            assert.equal(outcome, reply[0] === 200 ? "gone" : "error");
            assert.equal(calls.screen, undefined);
            assert.equal(calls.run, undefined);
        }
    });
});
