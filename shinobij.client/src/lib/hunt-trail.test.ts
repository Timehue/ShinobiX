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
    it("starts and ends at the mission sector", () => {
        assert.equal(huntRequiredTracks(boarHunt), 3);
        assert.equal(huntTrailSector(boarHunt, 0, "Rin"), 25);
        assert.equal(huntTrailSector(boarHunt, 2, "Rin"), 25);
        assert.equal(huntReadyForFight(boarHunt, 1), false);
        assert.equal(huntReadyForFight(boarHunt, 2), true);
    });

    it("moves intermediate trail stages to another same-biome sector", () => {
        const sector = huntTrailSector(boarHunt, 1, "Rin");
        assert.notEqual(sector, boarHunt.targetSector);
        assert.equal(biomeForWorldSector(sector), biomeForWorldSector(boarHunt.targetSector));
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

