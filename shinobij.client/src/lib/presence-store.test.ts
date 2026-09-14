import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { Character, PlayerRecord } from "../types/character";
import {
    getLiveSectorPlayers,
    moveLiveSectorPlayer,
    presenceSignature,
    pushLiveSectorPlayers,
    resetLiveSectorPlayers,
    setLiveSectorContext,
    upsertLiveSectorPlayer,
    correctLocalSectorTile, subscribeLocalSectorTileCorrections, getLocalSectorTile, setLocalSectorTile,
    getPendingLocalSectorCorrection,
} from "./presence-store";

function player(name: string, sector: number, patch: Partial<PlayerRecord> = {}): PlayerRecord {
    return {
        name,
        level: 20,
        village: "Leaf",
        specialty: "Ninjutsu",
        character: { avatarImage: "" } as Character,
        currentSector: sector,
        lastSeenAt: 1_000,
        ...patch,
    };
}

beforeEach(() => {
    resetLiveSectorPlayers();
});

test('server arrival corrections reach the mounted map without feeding normal walking back', () => {
    const updates: number[] = [];
    const unsubscribe = subscribeLocalSectorTileCorrections((tile) => updates.push(tile));
    setLocalSectorTile(17);
    assert.deepEqual(updates, []);
    correctLocalSectorTile(44);
    assert.equal(getLocalSectorTile(), 44);
    assert.deepEqual(updates, [44]);
    for (const invalid of [null, undefined, '17', -1, 144, NaN]) correctLocalSectorTile(invalid);
    assert.deepEqual(updates, [44]);
    unsubscribe();
    correctLocalSectorTile(45);
    assert.deepEqual(updates, [44], 'unmounted maps are not updated');
});

test('a lazy map consumes an arrival once, while navigation or account reset retires it', () => {
    correctLocalSectorTile(44, 13);
    setLiveSectorContext(13);
    assert.deepEqual(getPendingLocalSectorCorrection(), { tile: 44, sector: 13 });
    const received: unknown[] = [];
    const unsubscribe = subscribeLocalSectorTileCorrections((tile, sector) => received.push({ tile, sector }));
    assert.deepEqual(received, [{ tile: 44, sector: 13 }]);
    assert.equal(getPendingLocalSectorCorrection(), null);
    unsubscribe();
    correctLocalSectorTile(45, 13);
    setLiveSectorContext(14);
    assert.equal(getPendingLocalSectorCorrection(), null);
    correctLocalSectorTile(44, 13);
    resetLiveSectorPlayers();
    assert.equal(getPendingLocalSectorCorrection(), null);
});

test("live sector store rejects late snapshots from the previous sector", () => {
    setLiveSectorContext(7);
    pushLiveSectorPlayers([player("Aki", 7)], 7);
    assert.deepEqual(getLiveSectorPlayers().map((p) => p.name), ["Aki"]);

    setLiveSectorContext(8);
    assert.deepEqual(getLiveSectorPlayers(), []);

    pushLiveSectorPlayers([player("Aki", 7)], 7);
    assert.deepEqual(getLiveSectorPlayers(), [], "old-sector snapshot is ignored");

    pushLiveSectorPlayers([player("Ren", 8)], 8);
    assert.deepEqual(getLiveSectorPlayers().map((p) => p.name), ["Ren"]);
});

test("live sector store normalizes dev heartbeat records that only carry sector", () => {
    setLiveSectorContext(4);
    pushLiveSectorPlayers([
        {
            ...player("Mika", 0),
            currentSector: undefined,
            sector: 4,
        } as PlayerRecord & { sector: number },
    ], 4);

    assert.equal(getLiveSectorPlayers()[0]?.currentSector, 4);
});

test("presence signature changes when attack availability changes", () => {
    const idle = presenceSignature([player("Taro", 3, { inBattle: false })]);
    const fighting = presenceSignature([player("Taro", 3, { inBattle: true })]);

    assert.notEqual(idle, fighting);
});

test("socket deltas add and move a player without replacing the roster", () => {
    setLiveSectorContext(9);
    upsertLiveSectorPlayer(player("Aya", 9, { tile: 10 }), 9);
    assert.equal(getLiveSectorPlayers()[0]?.tile, 10);
    moveLiveSectorPlayer("Aya", 11, 9);
    assert.equal(getLiveSectorPlayers()[0]?.tile, 11);
});
