import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { type CoastFloor } from "../../../../shared/coast-world-rules";
import { GRID, col, row, open, pathTo, coastRoutine } from "./coast-grid";
import { DEN, KITCHEN, SHOP, den, residentSpots, shop, street } from "./stair-houses-rooms";

test("all six residents can be approached in their own room and the occupied cushion stays blocked", () => {
    const coast = JSON.parse(readFileSync(new URL("../../../../shared/coast-world.json", import.meta.url), "utf8"));
    const kitchen: CoastFloor = coast.layouts[105].sites["saltstair-houses-105"].floors[0];
    const floors = { Street: street, [KITCHEN]: kitchen, [SHOP]: shop, [DEN]: den };
    assert.deepEqual(Object.values(floors).map(room => room.doors.length), [2, 2, 2, 2]);
    assert.equal(Object.values(residentSpots).length, 6);
    assert.equal(Object.values(residentSpots).filter(spot => spot.place === "Street").length, 3);
    for (const [label, { place, feet: [x, y], approach, seatedArt }] of Object.entries(residentSpots)) {
        const room = floors[place];
        const tile = Math.floor(y / 100 * GRID) * GRID + Math.floor(x / 100 * GRID);
        if (seatedArt) {
            assert.equal(tile, 49, "The diner sits on the north cushion at the left table");
            assert(!open(room.mask, tile), "The player can walk onto the occupied cushion");
            assert.equal(approach, 68, "Speak from the opposite aisle by the right table");
            assert(!open(room.mask, approach + 1), "Keep the right table out of the walking route");
            assert(!open(room.mask, 61), "The player can cross the tabletop");
        } else {
            assert(pathTo(room.mask, room.spawn, tile), label + " stands beyond the walkable area");
            const route = coastRoutine(room.mask, tile, false, approach);
            assert(route, label + " needs space to walk");
            for (const [, at] of route.frames) {
                assert.notEqual(at, approach, label + " walks into the player's speaking position");
                assert.notEqual(at, room.spawn, label + " walks onto the entrance");
                assert(pathTo(room.mask, tile, at)!.length <= 2, label + " wanders away from their station");
            }
            if (place === KITCHEN) {
                assert.deepEqual([x, y], [34.8, 48], "The cook stays beside the stove");
                assert.equal(approach, 93, "Speak from the open floor toward the fish bench");
            } else if (place === SHOP) {
                assert.deepEqual([x, y], [78, 48.5], "The roof mender stays beside the shingle bench");
                assert.equal(approach, 98, "Speak from the aisle beside the left shelves");
            } else {
                const gap = Math.hypot(x - (col(approach) + .5) * 100 / GRID, y - (row(approach) + .5) * 100 / GRID);
                assert(gap >= 14, label + " needs space for the player to stop");
                assert(pathTo(room.mask, tile, approach)!.length <= 3, label + " is out of speaking range");
                const entrances = [...street.doors, ...street.stations.map(station => station.approach)];
                assert(!entrances.includes(tile) && !entrances.includes(approach), label + " occupies a doorway");
            }
        }
        assert(pathTo(room.mask, room.spawn, approach), label + " cannot be approached");
        assert.notEqual(approach, tile, label + " occupies the player's talking position");
    }
    assert.deepEqual(pathTo(street.mask, 73, 98), [85, 97, 98], "Reach the water carrier by the steps beside the well");
    assert(!open(street.mask, 86), "The well basin blocks walking");
    for (const room of Object.values(floors)) {
        for (const tile of [...room.doors, ...room.stations.map(station => station.approach)]) {
            assert(pathTo(room.mask, room.spawn, tile), room.title + " has an unreachable door or counter");
        }
    }
});

