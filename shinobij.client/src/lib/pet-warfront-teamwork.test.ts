import assert from "node:assert/strict";
import test from "node:test";
import type { DuelActorSnap, DuelEvent, DuelResult } from "./pet-duel-sim";
import { warfrontTeamwork } from "./pet-warfront-teamwork";

const actors = ["player-0", "player-1", "enemy-0", "enemy-1"].map((id, i): DuelActorSnap => ({
    id, team: i < 2 ? "player" : "enemy", slot: i % 2, hp: 100, maxHp: 100,
    x: i, y: 0, faceX: 1, faceY: 0, stamina: 100, state: "idle", statuses: [],
}));
const event = (t: number, actorId: string, targetId: string, type: DuelEvent["type"] = "hit"): DuelEvent =>
    ({ t, actorId, targetId, type, side: "player", dmg: 10 });
const result = (events: DuelEvent[]): DuelResult => ({ events, result: "win", winner: "player", ticks: 100,
    snapshots: Array.from({ length: 101 }, (_, t) => ({ t, actors, projectiles: [] })) });

test("teamwork reports a completed two-pet focus, not repeated hits or AOE from one pet", () => {
    const hits = [event(10, "player-0", "enemy-0"), event(11, "player-0", "enemy-1"), event(12, "player-0", "enemy-0")];
    assert.deepEqual(warfrontTeamwork(result(hits)), []);
    const plan = warfrontTeamwork(result([...hits, event(18, "player-1", "enemy-0")]));
    assert.equal(plan[0].tick, 18);
    assert.equal(plan[0].label, "FOCUS FIRE");
    assert.deepEqual(plan[0].allies, ["player-0", "player-1"]);
    assert.deepEqual(warfrontTeamwork(result([...hits, event(60, "player-1", "enemy-0")])), []);
});

test("ally support excludes self casts, empty healing and overlapping announcements", () => {
    const plan = warfrontTeamwork(result([
        event(0, "player-0", "player-0", "shield"),
        { ...event(1, "player-0", "player-1", "heal"), dmg: 0 },
        event(10, "player-0", "player-1", "shield"),
        event(12, "player-1", "player-0", "heal"),
        event(70, "player-1", "player-0", "heal"),
    ]));
    assert.deepEqual(plan.map(p => [p.tick, p.label]), [[10, "ALLY SHIELD"], [70, "ALLY HEAL"]]);
    assert.ok(plan[0].until < plan[1].tick);
});
