import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ServerPlayerSummary } from "../types/character";
import { deriveVillagePresence } from "./village-presence";

const players: ServerPlayerSummary[] = [
    { name: "River", level: 18, village: "Stormveil Village", online: true, currentSector: 12, lastSeenAt: 20 },
    { name: "Flint", level: 31, village: "Ashen Leaf Village", online: true, currentSector: 0, lastSeenAt: 30 },
    { name: "Quiet", level: 40, village: "Stormveil Village", online: false, currentSector: 8 },
    { name: "Clan-Archive", level: 1, village: "Stormveil Village", online: true },
    { name: "Operator", level: 100, village: "Stormveil Village", online: true, character: { rankTitle: "Admin" } as never },
    { name: "Kaze", level: 10, village: "Stormveil Village", online: true },
    { name: "River", level: 19, village: "Stormveil Village", online: true, currentSector: 13, lastSeenAt: 40 },
];

test("village presence counts only real, visible online shinobi and includes the mounted player", () => {
    const presence = deriveVillagePresence("Kaze", "Stormveil Village", players);

    assert.deepEqual(presence, {
        onlineTotal: 3,
        villageOnline: 2,
        inField: 1,
        visiblePlayers: [
            { name: "River", level: 19, village: "Stormveil Village" },
            { name: "Flint", level: 31, village: "Ashen Leaf Village" },
        ],
    });
});

test("village presence has an honest solo state when no other roster entry is online", () => {
    assert.deepEqual(deriveVillagePresence("Kaze", "Stormveil Village", []), {
        onlineTotal: 1,
        villageOnline: 1,
        inField: 0,
        visiblePlayers: [],
    });
});

test("the village pulse reuses shell presence and does not create a second polling path", () => {
    const source = readFileSync(new URL("../components/VillagePulse.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.match(source, /allServerPlayers/);
});
