import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/*
 * The War Hall must not write war state itself. Owner ruling: a village war never
 * changes who owns a sector, and a raid needs a real fight. The server refuses a
 * client territory write that lowers HP or flips ownership, and a client
 * `capturedBy` flip on the war row; this pins that the screen no longer sends
 * either, and that its text no longer describes the removed mechanics. The
 * behavioural halves (price, peace controls, crate eligibility) are tested in
 * lib/village-war-hall.test.ts.
 */
const screen = readFileSync(new URL("./VillageWarScreen.tsx", import.meta.url), "utf8");

describe("War Hall: no fightless raids or client captures", () => {
    it("sends no territory write and no capture or HP for the war row", () => {
        assert.doesNotMatch(screen, /kind:\s*"territory"/, "the raid's territory HP and ownership writes are gone");
        assert.doesNotMatch(screen, /capturedBy:\s*myVillage|capturedAt[,:]/, "the client capture write is gone");
        assert.doesNotMatch(screen, /raidSector|Raid \(-500 HP\)/, "no raid button");
        assert.doesNotMatch(screen, /hp:\s*\{\s*\.\.\.activeWar\.hp/, "the screen never computes war HP");
    });

    it("claims the winner's crate by the server-stamped id", () => {
        assert.match(screen, /claimableVillageWarCrates\(/);
        assert.doesNotMatch(screen, /`war-crate-\$\{/, "a rebuilt id never matched a rematch's -g<generation> crate");
    });

    it("prices the declaration from the village pool, not a fixed 500 personal Honor Seals", () => {
        assert.doesNotMatch(screen, /honorSeals \?\? 0\) < 500/);
        assert.match(screen, /loadWarDeclareQuote\(/);
        assert.match(screen, /warDeclareBlockReason\(/);
    });

    it("gives the Kage peace and a clearly confirmed surrender", () => {
        assert.match(screen, /runWarCommand\(peace\.peaceCommand\)/);
        assert.match(screen, /runWarCommand\("surrender"\)/);
        assert.match(screen, /warSurrenderConfirmText\([\s\S]{0,200}danger: true/);
        assert.doesNotMatch(screen, /The Kage may also call peace/);
    });

    it("no longer describes removed mechanics", () => {
        assert.doesNotMatch(screen, /\+750/, "a capture deals 100, not 750");
        assert.doesNotMatch(screen, /Top Raiders/);
        assert.doesNotMatch(screen, /Every successful war-ground raid pays/);
        assert.doesNotMatch(screen, /Clan Head|Clan-leadership gate/, "clan titles carry no war weight");
        assert.doesNotMatch(screen, /"Captured"/);
    });

    it("reads every war HP against the village's own max", () => {
        assert.match(screen, /villageWarHpMax\(war, village\)/);
        assert.doesNotMatch(screen, /VILLAGE_WAR_HP_MAX/);
    });

    // Ramparts lift a village's war HP past the 5,000 base. The other war HP
    // readouts divided by the fixed 5,000, so a walled village read over 100%.
    it("so does every other screen that shows village-war HP", () => {
        const council = readFileSync(new URL("./ShinobiCouncilHall.tsx", import.meta.url), "utf8");
        assert.match(council, /villageWarHpMax\(war, vA\)/);
        assert.match(council, /villageWarHpMax\(war, vB\)/);
        assert.doesNotMatch(council, /VILLAGE_WAR_HP_MAX/);
        const townHall = readFileSync(new URL("./TownHall.tsx", import.meta.url), "utf8");
        assert.doesNotMatch(townHall, /\/ VILLAGE_WAR_HP_MAX \* 100/, "no bar divides by the fixed base");
        assert.match(townHall, /villageWarHpMax\(primaryVillageWar, character\.village\)/);
        const worldMap = readFileSync(new URL("./WorldMap.tsx", import.meta.url), "utf8");
        assert.match(worldMap, /enemyVillageHpMax: villageWarEnemy \? villageWarHpMax\(villageWar, villageWarEnemy\)/);
    });
});
