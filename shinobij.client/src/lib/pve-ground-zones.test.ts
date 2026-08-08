import assert from "node:assert/strict";
import test from "node:test";
import {
    advancePveGroundZonesForTurn,
    pveGroundZoneDebuff,
    pveGroundZoneStatusRounds,
    type PveGroundZone,
} from "./pve-ground-zones";

function zone(id: string, owner: PveGroundZone["owner"], rounds = 2, tiles = [7]): PveGroundZone {
    return { id, owner, rounds, tiles, tags: [{ name: "Decrease Damage Given", percent: 20 }] };
}

test("ground-zone status refreshes match resources-v2 PvP", () => {
    assert.equal(pveGroundZoneStatusRounds("Decrease Damage Given", true), 1);
    assert.equal(pveGroundZoneStatusRounds("Recoil", true), 1);
    assert.equal(pveGroundZoneStatusRounds("Poison", true), 2);
    assert.equal(pveGroundZoneStatusRounds("Poison", false), 1);
    assert.deepEqual(pveGroundZoneDebuff({ name: "Decrease Damage Given", percent: 18 }, true), {
        name: "Decrease Damage Given",
        rounds: 1,
        percent: 18,
        kind: "negative",
    });
    assert.deepEqual(pveGroundZoneDebuff({ name: "Recoil" }, true), {
        name: "Recoil",
        rounds: 1,
        percent: 30,
        kind: "negative",
    });
    assert.deepEqual(pveGroundZoneDebuff({ name: "Poison" }, true), {
        name: "Poison",
        rounds: 2,
        percent: 6,
        kind: "negative",
    });
    assert.equal(pveGroundZoneDebuff({ name: "Wound" }, true), null);
});

test("player and enemy zones each receive two symmetric target-turn opportunities", () => {
    let zones = [zone("player-zone", "player"), zone("enemy-zone", "enemy")];

    const enemyTurnOne = advancePveGroundZonesForTurn(zones, "enemy", 7);
    assert.deepEqual(enemyTurnOne.hits.map((entry) => entry.id), ["player-zone"]);
    assert.deepEqual(enemyTurnOne.zones.map(({ id, rounds }) => [id, rounds]), [
        ["player-zone", 1],
        ["enemy-zone", 2],
    ]);
    zones = enemyTurnOne.zones;

    const playerTurnOne = advancePveGroundZonesForTurn(zones, "player", 7);
    assert.deepEqual(playerTurnOne.hits.map((entry) => entry.id), ["enemy-zone"]);
    assert.deepEqual(playerTurnOne.zones.map(({ id, rounds }) => [id, rounds]), [
        ["player-zone", 1],
        ["enemy-zone", 1],
    ]);
    zones = playerTurnOne.zones;

    const enemyTurnTwo = advancePveGroundZonesForTurn(zones, "enemy", 7);
    assert.deepEqual(enemyTurnTwo.hits.map((entry) => entry.id), ["player-zone"]);
    assert.deepEqual(enemyTurnTwo.zones.map((entry) => entry.id), ["enemy-zone"]);
    zones = enemyTurnTwo.zones;

    const playerTurnTwo = advancePveGroundZonesForTurn(zones, "player", 7);
    assert.deepEqual(playerTurnTwo.hits.map((entry) => entry.id), ["enemy-zone"]);
    assert.deepEqual(playerTurnTwo.zones, []);

    assert.deepEqual(advancePveGroundZonesForTurn(playerTurnTwo.zones, "enemy", 7).hits, []);
    assert.deepEqual(advancePveGroundZonesForTurn(playerTurnTwo.zones, "player", 7).hits, []);
});

test("a hostile zone expires on schedule even when the target leaves its tiles", () => {
    const first = advancePveGroundZonesForTurn([zone("smoke", "player")], "enemy", 99);
    assert.deepEqual(first.hits, []);
    assert.equal(first.zones[0]?.rounds, 1);

    const second = advancePveGroundZonesForTurn(first.zones, "enemy", 99);
    assert.deepEqual(second.hits, []);
    assert.deepEqual(second.zones, []);
});

test("a zone never targets or consumes itself on its owner's turn", () => {
    const result = advancePveGroundZonesForTurn([zone("friendly", "player")], "player", 7);
    assert.deepEqual(result.hits, []);
    assert.equal(result.zones[0]?.rounds, 2);
});
