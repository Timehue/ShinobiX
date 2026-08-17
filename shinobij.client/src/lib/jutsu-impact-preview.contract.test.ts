// The board's blast telegraph is a PROMISE about what the server will do. If it
// drifts, the player aims at a ring that does not detonate there — which is worse
// than the no-telegraph state this replaced, because now they trust it.
//
// So don't assert the preview against hand-written expectations: run the real
// server planner (api/combat-core/resolve-jutsu-action.ts — the same module solo
// PvE and PvP both resolve through) over every legal centre and require the two
// to agree tile for tile.

import { strict as assert } from "node:assert";
import test from "node:test";
import { resolveJutsuActionPlan } from "../../../api/combat-core/resolve-jutsu-action";
import { jutsuImpactPreviewTiles } from "./jutsu-impact-preview";
import { towerHexDistance, towerNeighbors, towerTilesInRange } from "./tower-grid";

const W = 12, H = 10;
const ALL = Array.from({ length: W * H }, (_, i) => i);
const dist = (a: number, b: number) => towerHexDistance(a, b, W);
const neighbors = (centre: number) => towerNeighbors(centre, W, H);
const board = { width: W, height: H, unavailableTiles: new Set<number>() };

/** The client-side telegraph, exactly as MissionArenaFight computes it. */
function previewCatchesEnemy(method: string, centre: number, enemyPos: number): boolean {
    return jutsuImpactPreviewTiles(method as Parameters<typeof jutsuImpactPreviewTiles>[0], centre, ALL, dist, neighbors).has(enemyPos);
}

function plan(jutsu: Record<string, unknown>, casterPos: number, opponentPos: number, tile: number) {
    return resolveJutsuActionPlan({
        jutsu: jutsu as never,
        casterPos,
        opponentPos,
        casterChakra: 9999,
        casterStamina: 9999,
        casterStatuses: [],
        round: 1,
        availableAp: 100,
        actionsThisTurn: 0,
        cooldownRemaining: 0,
        tile,
        board,
    });
}

const MOVE_AOE = {
    id: "blitz", name: "Blitz", ap: 40, range: 3, method: "AOE_CIRCLE",
    target: "EMPTY_GROUND", tags: [{ name: "Move" }, { name: "Damage" }],
};

test("the Move+AOE landing telegraph agrees with the server on every legal hex", () => {
    const casterPos = 50;
    let checked = 0, hits = 0;
    for (const enemyPos of [52, 38, 61, 27]) {
        const landings = [...towerTilesInRange(casterPos, 3, W, H)].filter(t => t !== casterPos && t !== enemyPos);
        assert.ok(landings.length > 10, "the fixture must exercise a real spread of landing tiles");
        for (const tile of landings) {
            const result = plan(MOVE_AOE, casterPos, enemyPos, tile);
            assert.ok(result.accepted, `the server must accept landing on ${tile}`);
            const server = result.accepted && result.hitsOpponent;
            const client = previewCatchesEnemy("AOE_CIRCLE", tile, enemyPos);
            assert.equal(
                client,
                server,
                `landing on ${tile} with the enemy on ${enemyPos}: the board says ` +
                `${client ? "the blast catches them" : "it misses"} but the server says ` +
                `${server ? "it catches them" : "it misses"}`,
            );
            checked++;
            if (server) hits++;
        }
    }
    // A telegraph that never lights up would pass a naive equality check.
    assert.ok(hits > 0, "the fixture must include landings that DO catch the enemy");
    assert.ok(hits < checked, "...and landings that miss, or the test proves nothing");
});

test("landing ON the enemy's own hex is never sold as a hit", () => {
    // AOE_CIRCLE is a ring: the server excludes its own centre from hitsOpponent
    // (`opponentPos !== targetTile`), and the client excludes it by asking for the
    // ring rather than the filled footprint. A mismatch here would tell the player
    // to aim at the one hex that cannot damage anyone.
    const enemyPos = 52;
    assert.equal(previewCatchesEnemy("AOE_CIRCLE", enemyPos, enemyPos), false);
    for (const ring of towerNeighbors(enemyPos, W, H)) {
        assert.equal(previewCatchesEnemy("AOE_CIRCLE", ring, enemyPos), true, `hex ${ring} touches the enemy`);
    }
});

test("a ground zone's footprint agrees with the server, centre included", () => {
    // Unlike the movement ring, a zone covers the hex it is placed on, so the
    // preview must include the centre or a zone dropped straight onto the enemy
    // would read as a miss.
    const casterPos = 50, enemyPos = 52;
    const zone = {
        id: "mud", name: "Mud Trap", ap: 40, range: 3, method: "INSTANT_EFFECT",
        target: "EMPTY_GROUND", tags: [{ name: "Slow" }],
    };
    for (const tile of [enemyPos, ...towerNeighbors(enemyPos, W, H), 40, 61]) {
        const result = plan(zone, casterPos, enemyPos, tile);
        if (!result.accepted) continue;
        assert.equal(
            previewCatchesEnemy("INSTANT_EFFECT", tile, enemyPos),
            result.hitsOpponent,
            `ground zone on ${tile} disagrees with the server about reaching ${enemyPos}`,
        );
    }
});
