import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { villages } from "../data/sectors";
import {
    ACADEMY_VOWS,
    academyCeremony,
    academyStoryMomentFor,
    academyVowDefinition,
    isAcademyVow,
} from "./academy-narrative";

describe("Academy narrative continuity", () => {
    it("defines three equal narrative vows with all later callbacks", () => {
        assert.deepEqual(ACADEMY_VOWS.map((vow) => vow.id), ["unbound", "seeker", "guardian"]);
        for (const vow of ACADEMY_VOWS) {
            assert.ok(vow.quote.length > 10);
            assert.ok(vow.shiranuiResponse.length > 20);
            assert.ok(vow.companionCallback.length > 20);
            assert.ok(vow.sparCallback.length > 10);
            assert.ok(vow.keepsakeLine.length > 20);
            assert.equal(academyVowDefinition(vow.id), vow);
            assert.equal(isAcademyVow(vow.id), true);
            assert.doesNotMatch(vow.meaning, /\bsystem\b/i, "identity copy must not sound like a game menu");
        }
    });

    it("has a distinct first-return rite for every playable village", () => {
        const rites = villages.map((village) => academyCeremony(village));
        assert.equal(new Set(rites.map((rite) => rite.rite)).size, villages.length);
        for (const rite of rites) {
            assert.ok(rite.witness.length > 0);
            assert.match(rite.fieldReport, /three moving rings.*companion confirms/i);
            assert.ok(rite.opening.length > 30);
            assert.ok(rite.villagePromise.length > 30);
            assert.match(rite.opening, /\bI\b|\bmy\b|\bwe\b|\bour\b/i, "a named witness must speak in their own voice");
        }
    });

    it("falls back safely when an old save has no vow or an unknown village", () => {
        assert.equal(academyVowDefinition(undefined).id, "unbound");
        assert.equal(isAcademyVow("power"), false);
        assert.equal(academyCeremony("Retired Village").rite, "First Field-Return Rite");
    });

    it("orders authored moments around real progress and survives refresh boundaries", () => {
        assert.equal(academyStoryMomentFor({
            step: "cafeteria", screen: "village", currentSector: 0,
            incidentSeen: false, sectorVisited: false,
        }), "sparOmen");
        assert.equal(academyStoryMomentFor({
            step: "cafeteria", screen: "cafeteria", currentSector: 0,
            incidentSeen: true, sectorVisited: false,
        }), null);

        // Merely opening the map from the village must not count as fieldwork.
        assert.equal(academyStoryMomentFor({
            step: "sectorReturn", screen: "worldMap", currentSector: 0,
            incidentSeen: true, sectorVisited: false,
        }), null);
        assert.equal(academyStoryMomentFor({
            step: "sectorReturn", screen: "worldMap", currentSector: 1,
            incidentSeen: true, sectorVisited: false,
        }), "fieldTrace");

        // After acknowledging the trace, refreshes resume at the return rite;
        // they never replay the field discovery or finish the Academy silently.
        assert.equal(academyStoryMomentFor({
            step: "sectorReturn", screen: "worldMap", currentSector: 1,
            incidentSeen: true, sectorVisited: true,
        }), null);
        assert.equal(academyStoryMomentFor({
            step: "sectorReturn", screen: "village", currentSector: 0,
            incidentSeen: true, sectorVisited: true,
        }), "returnCeremony");
        assert.equal(academyStoryMomentFor({
            step: "done", screen: "village", currentSector: 0,
            incidentSeen: true, sectorVisited: true,
        }), null);
    });
});
