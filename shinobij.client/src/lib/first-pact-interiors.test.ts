import assert from "node:assert/strict";
import test from "node:test";

import {
    FIRST_PACT_INTERIORS,
    FirstPactInteriorTile,
    findFirstPactInteriorPath,
    firstPactInteriorApproaches,
    firstPactInteriorAtDoor,
    firstPactInteriorDoor,
    firstPactInteriorEntry,
    firstPactInteriorExit,
    firstPactInteriorNpcLines,
    firstPactInteriorOccupied,
    firstPactInteriorSize,
    firstPactInteriorTileAt,
    isFirstPactInteriorWalkable,
} from "./first-pact-interiors";
import { FIRST_PACT_ARCHITECTURE, FIRST_PACT_NPCS, isFirstPactWalkable } from "./first-pact-world";
import { FIRST_PACT_MAIN_STEPS } from "../../../shared/first-pact-contract";

test("every authored public door opens a room, and every room answers a real door", () => {
    const doors = FIRST_PACT_ARCHITECTURE.filter((placement) => placement.publicThreshold != null);
    assert.ok(doors.length >= 6, "the city must keep its authored public doors");
    const roomed = new Set(FIRST_PACT_INTERIORS.map((interior) => interior.buildingId));
    for (const placement of doors) {
        assert.ok(
            roomed.has(placement.id),
            `${placement.id} has a public door the player can walk onto but no interior behind it`,
        );
    }
    for (const interior of FIRST_PACT_INTERIORS) {
        const placement = FIRST_PACT_ARCHITECTURE.find((entry) => entry.id === interior.buildingId);
        assert.ok(placement, `${interior.id} names a building that does not exist`);
        assert.ok(placement.publicThreshold, `${interior.id} opens off a building with no public door`);
    }
    assert.equal(new Set(FIRST_PACT_INTERIORS.map((interior) => interior.id)).size, FIRST_PACT_INTERIORS.length);
    assert.equal(roomed.size, FIRST_PACT_INTERIORS.length, "two rooms cannot share one building");
});

test("each door tile resolves to its own room and back out again", () => {
    for (const interior of FIRST_PACT_INTERIORS) {
        const exit = firstPactInteriorExit(interior);
        assert.equal(firstPactInteriorAtDoor(exit)?.id, interior.id, `${interior.id} must be reachable from its door tile`);
        assert.equal(isFirstPactWalkable(exit.x, exit.y), true, `${interior.id} exits onto a blocked world tile`);
    }
    assert.equal(firstPactInteriorAtDoor({ x: 42, y: 14 }), null, "open street must not open a room");
});

test("every room is a sealed shell with one door and a walkable step inside it", () => {
    for (const interior of FIRST_PACT_INTERIORS) {
        const { width, height } = firstPactInteriorSize(interior);
        assert.ok(width >= 9 && height >= 8, `${interior.id} is too small to read as a room`);
        for (const row of interior.rows) {
            assert.equal(row.length, width, `${interior.id} has a ragged row: ${JSON.stringify(row)}`);
        }
        const doorCells = interior.rows.join("").split("").filter((cell) => cell === "D");
        assert.equal(doorCells.length, 1, `${interior.id} must have exactly one door`);

        const door = firstPactInteriorDoor(interior);
        assert.equal(door.y, height - 1, `${interior.id} door must sit in the south wall, matching its street stair`);
        const entry = firstPactInteriorEntry(interior);
        assert.equal(isFirstPactInteriorWalkable(interior, entry.x, entry.y), true, `${interior.id} door opens into a wall`);

        for (let x = 0; x < width; x += 1) {
            for (const y of [0, height - 1]) {
                const tile = firstPactInteriorTileAt(interior, x, y);
                if (y === height - 1 && x === door.x) continue;
                assert.equal(tile, FirstPactInteriorTile.Wall, `${interior.id} leaks at ${x},${y}`);
            }
        }
        for (let y = 0; y < height; y += 1) {
            for (const x of [0, width - 1]) {
                assert.equal(firstPactInteriorTileAt(interior, x, y), FirstPactInteriorTile.Wall, `${interior.id} leaks at ${x},${y}`);
            }
        }
    }
});

test("no room strands its own floor: every walkable cell is reachable from the door", () => {
    for (const interior of FIRST_PACT_INTERIORS) {
        const { width, height } = firstPactInteriorSize(interior);
        const entry = firstPactInteriorEntry(interior);
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                if (!isFirstPactInteriorWalkable(interior, x, y)) continue;
                assert.ok(
                    findFirstPactInteriorPath(interior, entry, { x, y }).length > 0,
                    `${interior.id} strands walkable floor at ${x},${y}`,
                );
            }
        }
    }
});

test("every interior actor stands on reachable floor and speaks in whole sentences", () => {
    const worldIds = new Set(FIRST_PACT_NPCS.map((npc) => npc.id));
    const seen = new Set<string>();
    for (const interior of FIRST_PACT_INTERIORS) {
        assert.ok(interior.npcs.length >= 1, `${interior.id} needs someone worth entering for`);
        const entry = firstPactInteriorEntry(interior);
        for (const npc of interior.npcs) {
            assert.equal(worldIds.has(npc.id), false, `${npc.id} cannot exist both indoors and on the street`);
            assert.equal(seen.has(npc.id), false, `${npc.id} is defined twice`);
            seen.add(npc.id);
            assert.equal(
                isFirstPactInteriorWalkable(interior, npc.position.x, npc.position.y),
                true,
                `${npc.id} stands inside a wall`,
            );
            assert.ok(
                findFirstPactInteriorPath(interior, entry, npc.position).length > 0,
                `${npc.id} cannot be reached from the door`,
            );
            assert.ok(npc.lines.length >= 2, `${npc.id} needs more than one line`);
            for (const line of npc.lines) {
                assert.ok(line.length >= 40, `${npc.id} has a fragment rather than a sentence: ${JSON.stringify(line)}`);
                assert.ok(/[.!?]$/.test(line), `${npc.id} line must end as a sentence: ${JSON.stringify(line)}`);
            }
        }
    }
});

test("every room's focus is a solid thing the player can walk up to and read", () => {
    for (const interior of FIRST_PACT_INTERIORS) {
        const { focus } = interior;
        const entry = firstPactInteriorEntry(interior);
        assert.equal(
            isFirstPactInteriorWalkable(interior, focus.position.x, focus.position.y),
            false,
            `${interior.id} focus must be a solid furnishing, not open floor`,
        );
        const approaches = firstPactInteriorApproaches(interior, focus.position);
        assert.ok(approaches.length >= 1, `${interior.id} focus cannot be approached`);
        assert.ok(
            approaches.some((cell) => findFirstPactInteriorPath(interior, entry, cell).length > 0),
            `${interior.id} focus is walled off from the door`,
        );
        // Walking straight in from the door has to arrive at the thing the room
        // is built around. A focus one column off the aisle is reachable on a
        // flood fill and invisible in play: the player walks up, sees nothing,
        // and leaves. It happened in the Keeper's Lodge before this contract.
        assert.equal(
            focus.position.x,
            firstPactInteriorDoor(interior).x,
            `${interior.id} focus must sit at the head of the aisle the door opens onto`,
        );
        assert.ok(focus.lines.length >= 2, `${interior.id} focus needs its two-beat reveal`);
        for (const line of focus.lines) {
            assert.ok(line.length >= 40, `${interior.id} focus has a fragment: ${JSON.stringify(line)}`);
            assert.ok(/[.!?]$/.test(line), `${interior.id} focus line must end as a sentence`);
        }
    }
    assert.equal(
        new Set(FIRST_PACT_INTERIORS.map((interior) => interior.focus.id)).size,
        FIRST_PACT_INTERIORS.length,
        "each room's focus must be its own object",
    );
});

test("the room's own keeper cannot block the way to the thing worth reading", () => {
    for (const interior of FIRST_PACT_INTERIORS) {
        const entry = firstPactInteriorEntry(interior);
        const standing = firstPactInteriorOccupied(interior);
        assert.equal(
            standing.has(`${entry.x},${entry.y}`),
            false,
            `${interior.id} seats someone on the doorstep the player arrives on`,
        );
        const approaches = firstPactInteriorApproaches(interior, interior.focus.position)
            .filter((cell) => !standing.has(`${cell.x},${cell.y}`));
        assert.ok(
            approaches.some((cell) => findFirstPactInteriorPath(interior, entry, cell, standing).length > 0),
            `${interior.id} focus can be seen but never reached: someone is standing in the only aisle`,
        );
        for (const npc of interior.npcs) {
            const beside = firstPactInteriorApproaches(interior, npc.position)
                .filter((cell) => !standing.has(`${cell.x},${cell.y}`));
            assert.ok(
                beside.some((cell) => findFirstPactInteriorPath(interior, entry, cell, standing).length > 0),
                `${npc.id} cannot be stood next to, so they cannot be spoken to`,
            );
        }
    }
});

test("entering a building at a story moment is worth doing, and never dead-ends", () => {
    const steps = new Set<string>(FIRST_PACT_MAIN_STEPS);
    let covered = 0;
    for (const interior of FIRST_PACT_INTERIORS) {
        for (const npc of interior.npcs) {
            const seenSteps = new Set<string>();
            for (const entry of npc.stepLines ?? []) {
                assert.ok(steps.has(entry.step), `${npc.id} answers a story step that does not exist: ${entry.step}`);
                assert.equal(seenSteps.has(entry.step), false, `${npc.id} answers ${entry.step} twice`);
                seenSteps.add(entry.step);
                assert.ok(entry.lines.length >= 2, `${npc.id} needs a two-beat answer for ${entry.step}`);
                for (const line of entry.lines) {
                    assert.ok(line.length >= 40, `${npc.id} has a fragment at ${entry.step}: ${JSON.stringify(line)}`);
                    assert.ok(/[.!?]$/.test(line), `${npc.id} line at ${entry.step} must end as a sentence`);
                }
                covered += 1;
            }
            // Whatever the player's step, someone in the room always has something to say.
            for (const step of FIRST_PACT_MAIN_STEPS) {
                assert.ok(
                    firstPactInteriorNpcLines(npc, step).length >= 2,
                    `${npc.id} falls silent at ${step}`,
                );
            }
        }
    }
    assert.ok(covered >= 10, "the city's rooms must react to the story, not just decorate it");
    const answered = new Set(
        FIRST_PACT_INTERIORS.flatMap((interior) =>
            interior.npcs.flatMap((npc) => (npc.stepLines ?? []).map((entry) => entry.step))),
    );
    for (const step of ["investigate-city-omens", "return-to-vey", "recover-withheld-record", "make-first-pact"] as const) {
        assert.ok(answered.has(step), `no room in the city has anything to say during ${step}`);
    }
});

test("rooms are furnished rather than empty, without burying the aisle", () => {
    for (const interior of FIRST_PACT_INTERIORS) {
        const { width, height } = firstPactInteriorSize(interior);
        const inner = (width - 2) * (height - 2);
        let solid = 0;
        let walkable = 0;
        for (let y = 1; y < height - 1; y += 1) {
            for (let x = 1; x < width - 1; x += 1) {
                if (isFirstPactInteriorWalkable(interior, x, y)) walkable += 1;
                else solid += 1;
            }
        }
        assert.ok(solid / inner >= .2, `${interior.id} reads as an empty box`);
        assert.ok(walkable / inner >= .45, `${interior.id} is too cluttered to move through`);
    }
});
