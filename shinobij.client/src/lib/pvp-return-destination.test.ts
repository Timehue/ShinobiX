import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pvpReturnDestination } from "./pvp-return-destination";

describe("pvp return destination", () => {
    it("sends a sector attack back to the tile it was launched from", () => {
        assert.deepEqual(pvpReturnDestination({ sectorAttack: true, sector: 12 }, 3), {
            target: "worldMap",
            label: "Return to Sector 12",
        });
    });

    it("falls back to the player's current sector when the bout carried none", () => {
        assert.deepEqual(pvpReturnDestination({ sectorAttack: true }, 7), {
            target: "worldMap",
            label: "Return to Sector 7",
        });
    });

    it("sends every clan-war mode back to the clan screen", () => {
        for (const mode of ["clanWar", "clanWarRaid", "clanWarSiege"]) {
            assert.deepEqual(pvpReturnDestination({ mode }, 4), {
                target: "clan",
                label: "Return to Clan War",
            });
        }
    });

    it("prefers the sector return when a clan-war bout is also a sector attack", () => {
        // The player is standing on the contested tile either way, so the map
        // is the honest destination.
        const destination = pvpReturnDestination({ sectorAttack: true, mode: "clanWar", sector: 9 }, 1);
        assert.equal(destination.target, "worldMap");
    });

    it("returns to the arena for an ordinary bout, and for no context at all", () => {
        const arena = { target: "battleArena", label: "Return to Arena" };
        assert.deepEqual(pvpReturnDestination({ mode: "ranked" }, 2), arena);
        assert.deepEqual(pvpReturnDestination(null, 2), arena);
        assert.deepEqual(pvpReturnDestination(undefined, 2), arena);
    });

    it("does not treat a mode that merely contains clanWar as a clan bout", () => {
        assert.equal(pvpReturnDestination({ mode: "notClanWar" }, 2).target, "battleArena");
    });
});
