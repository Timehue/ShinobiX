import assert from "node:assert/strict";
import test from "node:test";
import type { DuelEvent, DuelResult } from "./pet-duel-sim";
import { buildWarfrontTechniqueTimeline, warfrontTechniqueProgress } from "./pet-warfront-techniques";

const hit = (over: Partial<DuelEvent> = {}): DuelEvent => ({ t: 10, type: "hit", actorId: "player-0",
    targetId: "enemy-0", side: "player", dmg: 25, element: "Fire", move: "Flame Crown", ...over });
const result = (events: DuelEvent[]): DuelResult => ({ result: "win", winner: "player", ticks: 70, events,
    snapshots: Array.from({ length: 71 }, (_, t) => ({ t, projectiles: [], actors: [
        { id: "player-0", team: "player", slot: 0, x: 2, y: 3, faceX: 1, faceY: 0,
            hp: 100, maxHp: 100, stamina: 0, state: "idle", statuses: [] },
        { id: "enemy-0", team: "enemy", slot: 0, x: 6, y: 3, faceX: -1, faceY: 0,
            hp: t < 10 ? 100 : 75, maxHp: 100, stamina: 0, state: "idle", statuses: [] },
    ] })),
});

test("only landed named techniques get grand effects; basic shots and misses stay compact", () => {
    const replay = result([hit({ move: undefined }), hit({ type: "whiff", t: 11 }), hit({ dmg: 0, t: 12 }), hit({ t: 13 })]);
    const before = JSON.stringify(replay);
    const timeline = buildWarfrontTechniqueTimeline(replay);
    assert.ok(timeline.slice(0, 13).every(frame => frame.length === 0));
    assert.equal(timeline[13].length, 1);
    assert.deepEqual([timeline[13][0].x, timeline[13][0].z], [6, 3]);
    assert.equal(timeline[13][0].heading, Math.PI / 2, "the impact must face along the caster's firing lane");
    assert.equal(JSON.stringify(replay), before, "spectacle cannot alter the authoritative result");
});

test("AOE remains one impact and simultaneous techniques stay within two readable focal points", () => {
    const timeline = buildWarfrontTechniqueTimeline(result([
        hit(), hit({ targetId: "enemy-1" }),
        hit({ actorId: "player-1", targetId: "enemy-1", element: "Water" }),
        hit({ actorId: "player-2", targetId: "enemy-2", element: "Lightning", signature: true }),
    ]));
    assert.equal(timeline[10].length, 2);
    assert.ok(timeline[10].some(a => a.signature), "simultaneous signatures have priority");
    assert.ok(timeline.every(frame => frame.length <= 2 && new Set(frame.map(a => a.targetId)).size === frame.length));
    assert.equal(timeline[10].filter(a => a.actorId === "player-0").length, 1);
});

test("grand effects advance solely with the replay tick and end before the next technique", () => {
    const timeline = buildWarfrontTechniqueTimeline(result([hit()]));
    const technique = timeline[10][0];
    assert.equal(warfrontTechniqueProgress(technique, 10), 0);
    assert.equal(warfrontTechniqueProgress(technique, 23.5), 0.5);
    assert.equal(warfrontTechniqueProgress(technique, 23.5), 0.5, "paused replay must freeze the effect");
    assert.equal(timeline[technique.end].length, 0);
    assert.equal(buildWarfrontTechniqueTimeline(result([])).flat().length, 0, "rematch cannot retain old effects");
});
