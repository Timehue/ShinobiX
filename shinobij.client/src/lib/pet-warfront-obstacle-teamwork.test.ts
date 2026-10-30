import assert from "node:assert/strict";
import test from "node:test";
import { rawPetPool } from "../data/pet-pool";
import type { Pet } from "../types/pet";
import { balanceBuiltInPetTemplate } from "./pet-balance";
import { runPetSquadDuelCinematic, WARFRONT_CELL_X, WARFRONT_CELL_Y } from "./pet-duel-cinematic";
import { WARFRONT_TERRAIN, WARFRONT_TPS } from "./pet-warfront-contract";
import { RITE_SQUAD_HP_SCALE } from "./pet-warfront-rite";

const member = (id: string, element: Pet["element"], role: Pet["role"], subRole: Pet["subRole"]): Pet => ({
    id, name: id, rarity: "rare", level: 1, xp: 0, maxLevel: 100,
    hp: 5000, attack: 90, defense: 65, speed: 90, element, role, subRole, jutsus: [],
} as Pet);
const band = () => [member("guard", "Earth", "defender", "tank"), member("fire", "Fire", "tracker", "kite"),
    member("water", "Water", "tracker", "kite"), member("wing", "Wind", "assassin", "assassin")];
const play = (seed: number, nodes = [5, 2, 8, 6]) => runPetSquadDuelCinematic(band(), band().reverse(), seed, false, false, true, nodes, [1, 4, 9, 3]);
const solids = WARFRONT_TERRAIN.filter(cell => cell.kind !== "mist");
const grid = (actor: { x: number; y: number }) => ({ col: actor.x / WARFRONT_CELL_X + 3, row: actor.y / WARFRONT_CELL_Y + 2 });
const inside = (point: { col: number; row: number }, margin = .48) => solids.some(cell => Math.abs(cell.col - point.col) < margin && Math.abs(cell.row - point.row) < margin);
/** A terrace's corner walls leave one lane open: the centreline of its own row. */
const onTerraceLane = (cell: typeof solids[number], point: { col: number; row: number }) => cell.kind === "cover"
    && Math.abs(point.row - cell.row) < 1e-6 && Math.abs(point.col - cell.col) < 1.5;

test("every movement frame clears the planted islands and crosses a terrace only along its lane, including shadow steps", () => {
    let dashes = 0, nearTerraces = 0, laneFrames = 0;
    for (const seed of [2, 7, 20, 23, 31, 44]) for (const nodes of [[5, 2, 8, 6], [0, 9, 4, 7]]) {
        const result = play(seed, nodes);
        const previous = new Map<string, { x: number; y: number }>();
        for (const snapshot of result.snapshots) for (const actor of snapshot.actors) {
            const point = grid(actor);
            const lane = solids.find(cell => onTerraceLane(cell, point));
            const before = previous.get(actor.id);
            previous.set(actor.id, actor);
            if (lane && inside(point)) {
                laneFrames++;
                // A hit can change the state label mid-run, but never the run.
                assert.ok(before && (before.x !== actor.x || before.y !== actor.y), `${seed}/${snapshot.t}: ${actor.id} stopped inside the terrace at ${point.col},${point.row}`);
                continue;
            }
            assert.ok(!inside(point), `${seed}/${snapshot.t}: ${actor.id} entered solid scenery at ${point.col},${point.row}`);
            const clearance = Math.min(...solids.filter(cell => cell !== lane).map(cell => Math.hypot(
                Math.max(0, Math.abs(cell.col - point.col) - .48),
                Math.max(0, Math.abs(cell.row - point.row) - .48),
            )));
            assert.ok(clearance >= .45, `${seed}/${snapshot.t}: ${actor.id} clips an obstacle corner with ${clearance} cells of body clearance`);
            if (actor.state === "dash") {
                dashes++;
                if (WARFRONT_TERRAIN.some(cell => cell.kind === "cover" && Math.hypot(cell.col - point.col, cell.row - point.row) < 1.6)) nearTerraces++;
            }
        }
    }
    assert.ok(dashes > 1000 && nearTerraces > 100, "exercise live routes alongside the terraces, not just untouched scenery");
    assert.ok(laneFrames > 20, "pets must really use the terrace lanes, or rows 0 and 4 are still sealed");
});

test("no pet is left standing idle behind the terrain while the fight goes on", () => {
    const pool = rawPetPool.filter(pet => pet.rarity !== "mythic").map(pet => balanceBuiltInPetTemplate(pet));
    const roster = (seed: number, tag: string) => {
        const picked: Pet[] = [];
        for (let index = 0; picked.length < 4; index++) {
            const candidate = pool[(seed * 31 + index * 17) % pool.length];
            if (!picked.some(pet => pet.id === candidate.id)) picked.push(candidate);
        }
        return picked.map((pet, slot) => ({ ...pet, id: `${tag}-${pet.id}-${slot}`, hp: Math.round(pet.hp * RITE_SQUAD_HP_SCALE) }));
    };
    let stalledClashes = 0, longest = 0;
    const clashes = 60;
    for (let seed = 1; seed <= clashes; seed++) {
        const result = runPetSquadDuelCinematic(roster(seed, "a"), roster(seed + 1000, "b"), seed * 7919, false, true, true, [3, 4, 7, 8], [3, 4, 7, 8]);
        let worst = 0;
        for (const { id } of result.snapshots[0].actors) {
            let run = 0, previous: { x: number; y: number } | undefined;
            for (const snapshot of result.snapshots) {
                const actor = snapshot.actors.find(candidate => candidate.id === id)!;
                if (actor.hp <= 0) break;
                run = actor.state === "idle" && actor.x === previous?.x && actor.y === previous?.y ? run + 1 : 0;
                worst = Math.max(worst, run);
                previous = actor;
            }
        }
        longest = Math.max(longest, worst);
        if (worst >= WARFRONT_TPS * 4) stalledClashes++;
    }
    // One crossing cell used to carry the whole board: about half of all clashes
    // parked a pet for 4+ seconds, and the worst stood idle for nearly 15.
    assert.ok(stalledClashes <= 3, `${stalledClashes}/${clashes} clashes left a pet idle for 4+ seconds`);
    assert.ok(longest < WARFRONT_TPS * 7, `a pet stood idle for ${(longest / WARFRONT_TPS).toFixed(1)}s`);
});

test("shared focus orders produce actual two-pet damage and deliberate crossfire movement", () => {
    let assists = 0, crossfire = 0;
    for (const seed of [2, 7, 20, 23, 31]) {
        const result = play(seed);
        const hits = result.events.filter(event => event.type === "hit" && (event.dmg ?? 0) > 0);
        for (const snapshot of result.snapshots) {
            for (const actor of snapshot.actors) {
                if (actor.ai?.plan === "open a crossfire lane" && actor.state === "dash") crossfire++;
                if (actor.ai?.plan !== "coordinate a two-pet focus") continue;
                const ownHit = hits.find(hit => hit.actorId === actor.id && hit.targetId === actor.targetId && hit.t >= snapshot.t && hit.t <= snapshot.t + 60);
                if (ownHit && hits.some(hit => hit.side === ownHit.side && hit.actorId !== ownHit.actorId
                    && hit.targetId === ownHit.targetId && Math.abs(hit.t - ownHit.t) <= 30)) assists++;
            }
        }
    }
    assert.ok(assists > 20, "shared orders must become two teammates landing damage on one contact");
    assert.ok(crossfire > 20, "a ranged teammate must physically change its firing angle between volleys");
});

test("ranged hits cannot cut through the visible stone footprints", () => {
    let checked = 0;
    const clear = (a: { x: number; y: number }, b: { x: number; y: number }) => {
        const from = grid(a), to = grid(b);
        for (let step = 1; step < 80; step++) {
            const t = step / 80;
            if (inside({ col: from.col + (to.col - from.col) * t, row: from.row + (to.row - from.row) * t }, .4)) return false;
        }
        return true;
    };
    for (const seed of [2, 20, 23]) {
        const result = play(seed);
        for (const hit of result.events.filter(event => event.type === "hit" && event.ranged && (event.dmg ?? 0) > 0)) {
            // The target may advance one tick after the attack in alternating
            // initiative order. Its actual impact lies between these frames.
            const frames = result.snapshots.filter(snapshot => snapshot.t === hit.t || snapshot.t === hit.t - 1);
            assert.ok(frames.some(snapshot => {
                const from = snapshot.actors.find(actor => actor.id === hit.actorId);
                const to = snapshot.actors.find(actor => actor.id === hit.targetId);
                return from && to && clear(from, to);
            }), `${seed}/${hit.t}: ${hit.actorId} shot through solid scenery`);
            checked++;
        }
    }
    assert.ok(checked > 40, "exercise live ranged attacks across both halves of the court");
});
