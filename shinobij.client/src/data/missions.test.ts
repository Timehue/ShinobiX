import { test } from "node:test";
import assert from "node:assert/strict";
import { builtinFetchMissions, fieldMissionNextAction, fieldMissionRaidNeeded, nextFieldMissionObjective, sortFieldMissions } from "./missions";
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

test("field mission suggests the next objective while allowing either progress order", () => {
    const contract = { ...mission("fetch-d-supply-trail", "D Rank"), targetSector: 18, exploreCount: 3, raidCount: 1 };
    assert.equal(nextFieldMissionObjective(contract, 0, 0), "explore");
    assert.equal(nextFieldMissionObjective(contract, 3, 0), "raid");
    assert.equal(nextFieldMissionObjective(contract, 3, 1), "claim");
    assert.equal(nextFieldMissionObjective(contract, 99, 99), "claim");
    assert.equal(fieldMissionRaidNeeded(contract, 0), true);
    assert.equal(fieldMissionRaidNeeded(contract, 1), false);
    assert.deepEqual(fieldMissionNextAction(contract, 0, 0, 0), {
        objective: "explore", instruction: "World Map → Sector 18 → Explore.", label: "Explore Sector 18",
    });
    assert.deepEqual(fieldMissionNextAction(contract, 3, 0, 0), {
        objective: "raid", instruction: "Go to Mission Outpost in Sector 18.", label: "Go to Mission Outpost",
    });
    assert.deepEqual(fieldMissionNextAction(contract, 3, 0, 18), {
        objective: "raid", instruction: "Raid Mission Outpost.", label: "Raid Mission Outpost",
    });
    assert.equal(fieldMissionNextAction(contract, 3, 1, 18).label, "Claim Reward");
    assert.equal(fieldMissionNextAction(contract, 0, 1, 18).objective, "explore");
});

test("every built-in field mission points to its own World Map sector", () => {
    for (const contract of builtinFetchMissions) {
        assert.equal(
            fieldMissionNextAction(contract, 0, 0, 0).instruction,
            `World Map → Sector ${contract.targetSector} → Explore.`,
        );
    }
    const customContract = { ...mission("custom-field", "C Rank"), targetSector: 27 };
    assert.equal(fieldMissionNextAction(customContract, 0, 0, 0).instruction, "World Map → Sector 27 → Explore.");
});
