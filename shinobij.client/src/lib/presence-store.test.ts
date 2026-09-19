import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { Character, PlayerRecord } from "../types/character";
import {
    getLastFullRoster,
    getLiveSectorPlayers,
    getLiveSectorRoster,
    moveLiveSectorPlayer,
    presenceSignature,
    pushLiveSectorPlayers,
    removeLiveSectorPlayers,
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

const names = () => getLiveSectorPlayers().map((p) => p.name).sort();

test("a leave names the account slug; a player with a spaced display name still goes", () => {
    setLiveSectorContext(12);
    pushLiveSectorPlayers([player("Shadow Fox", 12), player("Aki", 12)], 12);
    // The server's presence:leave / presence:gone carry safeName slugs.
    removeLiveSectorPlayers(["shadowfox"]);
    assert.deepEqual(names(), ["Aki"]);
    assert.deepEqual(getLiveSectorRoster().map((p) => p.name), ["Aki"], "the Players Here panel drops them too");
});

test("socket moves and updates match a player by slug as well", () => {
    setLiveSectorContext(12);
    upsertLiveSectorPlayer(player("Shadow Fox", 12, { tile: 3 }), 12);
    upsertLiveSectorPlayer(player("Shadow Fox", 12, { tile: 3, level: 21 }), 12);
    moveLiveSectorPlayer("Shadow Fox", 4, 12);
    assert.deepEqual(getLiveSectorPlayers().map((p) => [p.name, p.level, p.tile]), [["Shadow Fox", 21, 4]]);
});

test("a player missing from a roster drops after the linger even if no roster follows", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
    setLiveSectorContext(12);
    pushLiveSectorPlayers([player("Aki", 12), player("Ren", 12)], 12);
    pushLiveSectorPlayers([player("Aki", 12)], 12);
    assert.deepEqual(names(), ["Aki", "Ren"], "a one-roster gap does not blink them out");
    t.mock.timers.tick(2_499);
    assert.deepEqual(names(), ["Aki", "Ren"]);
    t.mock.timers.tick(2);
    assert.deepEqual(names(), ["Aki"], "gone without waiting a minute for the next roster");
});

test("a player who reappears inside the linger stays", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
    setLiveSectorContext(12);
    pushLiveSectorPlayers([player("Aki", 12), player("Ren", 12)], 12);
    pushLiveSectorPlayers([player("Aki", 12)], 12);
    t.mock.timers.tick(1_000);
    upsertLiveSectorPlayer(player("Ren", 12), 12);
    t.mock.timers.tick(5_000);
    assert.deepEqual(names(), ["Aki", "Ren"]);
});

test("a roster older than a socket leave does not bring the player back", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
    setLiveSectorContext(12);
    pushLiveSectorPlayers([player("Aki", 12), player("Ren", 12)], 12);
    removeLiveSectorPlayers(["ren"]);
    // The HTTP beat's roster was built before Ren left and arrives after.
    pushLiveSectorPlayers([player("Aki", 12), player("Ren", 12)], 12);
    assert.deepEqual(names(), ["Aki"]);
    // Much later, a roster that still lists Ren is believed.
    t.mock.timers.tick(6_000);
    pushLiveSectorPlayers([player("Aki", 12), player("Ren", 12)], 12);
    assert.deepEqual(names(), ["Aki", "Ren"]);
});

test("a roster older than a socket arrival does not drop the new arrival", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
    setLiveSectorContext(12);
    pushLiveSectorPlayers([player("Aki", 12)], 12);
    upsertLiveSectorPlayer(player("Ren", 12), 12);
    // Built before Ren arrived, delivered after the socket told us.
    pushLiveSectorPlayers([player("Aki", 12)], 12);
    t.mock.timers.tick(10_000);
    assert.deepEqual(names(), ["Aki", "Ren"]);
});

test("a player who leaves and comes back is shown again at once", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
    setLiveSectorContext(12);
    pushLiveSectorPlayers([player("Aki", 12), player("Ren", 12)], 12);
    removeLiveSectorPlayers(["ren"]);
    upsertLiveSectorPlayer(player("Ren", 12), 12);
    pushLiveSectorPlayers([player("Aki", 12), player("Ren", 12)], 12);
    assert.deepEqual(names(), ["Aki", "Ren"]);
});

test("the store remembers which sector its last full roster was for", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    assert.equal(getLastFullRoster(), null);
    setLiveSectorContext(12);
    upsertLiveSectorPlayer(player("Aki", 12), 12);
    assert.equal(getLastFullRoster(), null, "a single delta is not a full roster");
    pushLiveSectorPlayers([player("Aki", 12)], 12);
    assert.deepEqual(getLastFullRoster(), { sector: 12, at: 1_000_000 });
    pushLiveSectorPlayers([player("Ren", 13)], 13);
    assert.deepEqual(getLastFullRoster(), { sector: 12, at: 1_000_000 }, "a rejected roster for another sector does not count");
    setLiveSectorContext(13);
    assert.equal(getLastFullRoster(), null);
});

test("a leave for the sector this client just left does not hide a companion who arrived with it", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
    setLiveSectorContext(12);
    pushLiveSectorPlayers([player("Aki", 12), player("Companion", 12)], 12);
    // Both travel to 13. This client switches first; its socket is still in
    // sector 12's room and then hears the companion leave 12.
    setLiveSectorContext(13);
    pushLiveSectorPlayers([player("Companion", 13)], 13);
    removeLiveSectorPlayers(["companion"], 12);
    assert.deepEqual(names(), ["Companion"], "a leave for another sector is ignored");
    pushLiveSectorPlayers([player("Companion", 13)], 13);
    assert.deepEqual(names(), ["Companion"], "and leaves no tombstone behind");
    removeLiveSectorPlayers(["companion"], 13);
    assert.deepEqual(names(), [], "a leave for this sector still applies");
});
