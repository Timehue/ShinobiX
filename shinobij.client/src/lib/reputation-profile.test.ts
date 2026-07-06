import test from "node:test";
import assert from "node:assert/strict";
import type { Character } from "../types/character";
import type { BountyEntry } from "./pvp-bounty";
import {
    bountyBackerLabel,
    buildReputationProfile,
    findBountyForTarget,
    formatBountyAge,
    sortBountiesByAmount,
} from "./reputation-profile";

function character(overrides: Partial<Character> = {}): Character {
    return {
        name: "Akari",
        village: "Leaf",
        specialty: "Ninjutsu",
        bloodline: "Storm",
        level: 42,
        xp: 0,
        ryo: 0,
        bankRyo: 0,
        honorSeals: 0,
        auraDust: 0,
        auraSphereLevel: 0,
        fateShards: 0,
        hp: 100,
        maxHp: 100,
        chakra: 100,
        maxChakra: 100,
        stamina: 100,
        maxStamina: 100,
        rankTitle: "Jonin",
        storyProgress: 0,
        storyVillage: "Leaf",
        stats: {
            speed: 1,
            strength: 1,
            intelligence: 1,
            willpower: 1,
            taijutsuOffense: 1,
            taijutsuDefense: 1,
            ninjutsuOffense: 1,
            ninjutsuDefense: 1,
            genjutsuOffense: 1,
            genjutsuDefense: 1,
            bukijutsuOffense: 1,
            bukijutsuDefense: 1,
        },
        unspentStats: 0,
        equippedJutsuIds: [],
        inventory: [],
        equipment: {},
        jutsuMastery: [],
        pets: [],
        tileCards: [],
        boneCharms: 0,
        auraStones: 0,
        mythicSeals: 0,
        clanBattleContrib: 0,
        clanEventContrib: 0,
        clanMissionContrib: 0,
        villageUpgrades: {},
        ...overrides,
    };
}

test("buildReputationProfile surfaces only real bounty and rivalry data", () => {
    const bounty: BountyEntry = {
        target: "Akari",
        amount: 7500,
        contributors: ["Hana", "Ren"],
        updatedAt: 1_700_000_000_000,
    };
    const profile = buildReputationProfile(character({
        customTitle: "Stormblade",
        rankedRating: 1210,
        rankedWins: 6,
        rankedLosses: 2,
        totalPvpKills: 9,
        monthlyPvpKills: 3,
        wandererNemesis: { name: "Ash Bandit", level: 40, tier: 2 },
    }), { bounty, elements: ["Lightning"] });

    assert.equal(profile.displayTitle, "Stormblade");
    assert.equal(profile.rivalry.kind, "npc");
    assert.match(profile.rivalry.detail, /Ash Bandit/);
    assert.equal(profile.identityChips.some((chip) => chip.label === "Lightning"), true);
    assert.deepEqual(
        profile.metrics.filter((metric) => metric.id === "bounty").map((metric) => [metric.value, metric.detail]),
        [["7,500 ryo", "2 backers"]],
    );
    assert.deepEqual(
        profile.metrics.filter((metric) => metric.id === "ranked").map((metric) => [metric.value, metric.detail]),
        [["1,210", "6W / 2L"]],
    );
});

test("buildReputationProfile keeps absent player rivalry and bounty empty", () => {
    const profile = buildReputationProfile(character());
    assert.equal(profile.rivalry.kind, "none");
    assert.equal(profile.metrics.find((metric) => metric.id === "bounty")?.value, "None");
    assert.equal(profile.metrics.find((metric) => metric.id === "ranked")?.value, "Unranked");
});

test("bounty helpers sort, match case-insensitively, and age entries", () => {
    const bounties: BountyEntry[] = [
        { target: "Ren", amount: 2500, contributors: [], updatedAt: 1_000 },
        { target: "Akari", amount: 9000, contributors: ["Hana"], updatedAt: 3_600_000 },
    ];

    assert.deepEqual(sortBountiesByAmount(bounties).map((bounty) => bounty.target), ["Akari", "Ren"]);
    assert.equal(findBountyForTarget(bounties, "akari")?.amount, 9000);
    assert.equal(bountyBackerLabel(bounties[0]), "No listed backers");
    assert.equal(bountyBackerLabel(bounties[1]), "1 backer");
    assert.equal(formatBountyAge(3_600_000, 3_660_000), "just now");
    assert.equal(formatBountyAge(0), "recent");
});
