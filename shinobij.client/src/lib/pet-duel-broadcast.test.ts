import assert from "node:assert/strict";
import test from "node:test";
import type { DuelResult } from "./pet-duel-sim";
import { petDuelBroadcastRead, petDuelRecap } from "./pet-duel-broadcast";

const duel: DuelResult = {
    result: "win",
    winner: "player",
    ticks: 40,
    snapshots: [
        {
            t: 0,
            actors: [
                { id: "player-0", team: "player", hp: 100, maxHp: 100 },
                { id: "enemy-0", team: "enemy", hp: 100, maxHp: 100 },
            ],
        },
        {
            t: 40,
            actors: [
                { id: "player-0", team: "player", hp: 35, maxHp: 100 },
                { id: "enemy-0", team: "enemy", hp: 0, maxHp: 100 },
            ],
        },
    ] as DuelResult["snapshots"],
    events: [
        { t: 10, type: "hit", side: "player", actorId: "player-0", targetId: "enemy-0", dmg: 22, move: "Clash Break" },
        { t: 20, type: "hit", side: "enemy", actorId: "enemy-0", targetId: "player-0", dmg: 18 },
        { t: 25, type: "stagger", side: "player", actorId: "player-0", targetId: "enemy-0", move: "Clash" },
        { t: 25, type: "stagger", side: "enemy", actorId: "enemy-0", targetId: "player-0", move: "Clash" },
    ] as DuelResult["events"],
};

test("broadcast read turns team HP into a stable spectator call", () => {
    assert.deepEqual(petDuelBroadcastRead(duel, 0), {
        player: { hp: 100, maxHp: 100, percent: 100, alive: 1 },
        enemy: { hp: 100, maxHp: 100, percent: 100, alive: 1 },
        elapsedSeconds: 0,
        lead: "even",
        call: "Dead even",
    });
    assert.equal(petDuelBroadcastRead(duel, 40).call, "You have the edge");
});

test("recap counts decisive Clash wins once and paired deadlocks once", () => {
    assert.deepEqual(petDuelRecap(duel), {
        durationSeconds: 2,
        playerClashWins: 1,
        enemyClashWins: 0,
        clashDeadlocks: 1,
        playerDamage: 22,
        enemyDamage: 18,
        winnerHpPercent: 35,
    });
});
