import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { biomeForWorldSector } from "../data/sectors";
import type { CreatorMission } from "../types/missions";
import { huntReadyForFight, huntRequiredTracks, huntTrailSector } from "./hunt-trail";

const boarHunt: CreatorMission = {
    id: "hunt-wild-boar",
    name: "Hunt the Wild Boar",
    rank: "D Rank",
    description: "Track and defeat the target.",
    type: "fetchExplore",
    targetSector: 25,
    exploreCount: 3,
    levelReq: 1,
    xpReward: 80,
    ryoReward: 60,
    staminaReward: 8,
};

describe("hunt-trail", () => {
    it("ends at the mission sector, but does not start there", () => {
        assert.equal(huntRequiredTracks(boarHunt), 3);
        // The final stage is the beast's ground.
        assert.equal(huntTrailSector(boarHunt, 2, "Rin"), 25);
        // Stage 0 is the FIRST sign, not the destination. It used to return the
        // target, so the trail ran target -> elsewhere -> target and the player
        // started on the destination, got yanked away, then pulled back.
        assert.notEqual(huntTrailSector(boarHunt, 0, "Rin"), 25);
        assert.equal(huntReadyForFight(boarHunt, 1), false);
        assert.equal(huntReadyForFight(boarHunt, 2), true);
    });

    it("moves approach stages to another same-biome sector", () => {
        for (const stage of [0, 1]) {
            const sector = huntTrailSector(boarHunt, stage, "Rin");
            assert.notEqual(sector, boarHunt.targetSector);
            assert.equal(biomeForWorldSector(sector), biomeForWorldSector(boarHunt.targetSector));
        }
    });

    it("closes in on the target instead of bouncing around the biome", () => {
        // Each track should land no further from the beast than the last one.
        const longHunt = { ...boarHunt, id: "hunt-long", exploreCount: 6 };
        const required = huntRequiredTracks(longHunt);
        const distances = Array.from({ length: required }, (_, stage) =>
            Math.abs(huntTrailSector(longHunt, stage, "Rin") - longHunt.targetSector));

        for (let stage = 1; stage < distances.length; stage += 1) {
            assert.ok(
                distances[stage] <= distances[stage - 1],
                `stage ${stage} (distance ${distances[stage]}) moved AWAY from the target ` +
                `versus stage ${stage - 1} (distance ${distances[stage - 1]})`,
            );
        }
        // And it genuinely starts away from the beast and finishes on it.
        assert.ok(distances[0] > 0);
        assert.equal(distances[distances.length - 1], 0);
    });

    it("keeps the same route stable for a player and mission", () => {
        const first = huntTrailSector(boarHunt, 1, "Rin");
        const second = huntTrailSector(boarHunt, 1, "Rin");
        assert.equal(second, first);
    });

    it("one-track hunts are immediately ready to fight", () => {
        const shortHunt = { ...boarHunt, id: "hunt-short", exploreCount: 1 };
        assert.equal(huntTrailSector(shortHunt, 0, "Rin"), shortHunt.targetSector);
        assert.equal(huntReadyForFight(shortHunt, 0), true);
    });
});
