import { test } from "node:test";
import assert from "node:assert/strict";
import { sortFieldMissions } from "./missions";
import type { CreatorMission, MissionRank } from "../types/missions";

function mission(id: string, rank: MissionRank, name = id): CreatorMission {
    return {
        id,
        name,
        rank,
        description: "Test field contract",
        type: "fetchExplore",
        targetSector: 1,
        exploreCount: 1,
        levelReq: 1,
        xpReward: 1,
        ryoReward: 1,
        staminaReward: 0,
    };
}

test("field missions follow shinobi progression order and alphabetize within a rank", () => {
    const source = [
        mission("s", "S Rank"),
        mission("a-zulu", "A Rank", "Zulu"),
        mission("d", "D Rank"),
        mission("b", "B Rank"),
        mission("c", "C Rank"),
        mission("a-alpha", "A Rank", "Alpha"),
    ];

    assert.deepEqual(
        sortFieldMissions(source).map((entry) => entry.id),
        ["d", "c", "b", "a-alpha", "a-zulu", "s"],
    );
    assert.equal(source[0].id, "s", "sorting does not mutate the supplied mission catalog");
});
