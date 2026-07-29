import { test } from "node:test";
import assert from "node:assert/strict";
import type { Character, HollowGateShrineRun } from "../types/character";
import type { Pet } from "../types/pet";
import {
    buildHollowGatePveEncounter,
    formatHollowGateCombatReward,
    hollowGatePveFightFromStoryContext,
} from "./hollow-gate-pve";

const pet = {
    id: "starter-fire",
    name: "Ember",
    level: 12,
} as Pet;

const character = {
    level: 35,
    pets: [pet],
    activePetId: pet.id,
    hp: 20,
    maxHp: 500,
    chakra: 30,
    maxChakra: 400,
    stamina: 40,
    maxStamina: 300,
} as Character;

test("normal Hollow Gate PvE builds an Arena Hollow Hound instead of a shinobi/tower foe", () => {
    const encounter = buildHollowGatePveEncounter({
        fight: { runId: "run-1", nodeId: "floor:2:tile:9", floor: 2, kind: "battle" },
        character,
        run: { floor: 2 } as HollowGateShrineRun,
        petAssisted: false,
        image: "/pet-poses/mythic-4-idle.webp",
    });
    assert.equal(encounter.ai.name, "Veilrunner Hollow Hound");
    assert.equal(encounter.ai.image, "/pet-poses/mythic-4-idle.webp");
    assert.equal(encounter.ai.village, "Hollow Gate");
    assert.ok(encounter.ai.jutsuIds.length > 0, "Hounds use the mission PvE combat AI rather than an inert placeholder");
    assert.ok(encounter.ai.rules.some((rule) => rule.action === "use_basic_attack"));
    assert.equal(encounter.canWithdraw, true);
});

test("a refreshed Arena story context restores the exact Hollow Gate fight pointer", () => {
    assert.deepEqual(hollowGatePveFightFromStoryContext({
        kind: "hollowGateShrine",
        runId: "hgcombat-123",
        nodeId: "floor:4:tile:77",
        floor: 4,
        combatKind: "elite",
        returnScreen: "hollowGateShrine",
    }), {
        runId: "hgcombat-123",
        nodeId: "floor:4:tile:77",
        floor: 4,
        kind: "elite",
    });
    assert.equal(hollowGatePveFightFromStoryContext({ kind: "weeklyBoss" }), null);
    assert.equal(hollowGatePveFightFromStoryContext({
        kind: "hollowGateShrine",
        runId: "",
        nodeId: "floor:1:tile:2",
        floor: 1,
        combatKind: "battle",
    }), null);
});

test("shinobi PvE never applies hidden pet assistance and Berserker's Gamble seals withdrawal", () => {
    const fight = { runId: "run-2", nodeId: "floor:5:tile:20", floor: 5, kind: "boss" as const };
    const plain = buildHollowGatePveEncounter({
        fight,
        character,
        run: {
            floor: 5,
            chosenAugment: {
                id: "berserkers-gamble",
                label: "Berserker's Gamble",
                description: "No retreat.",
                rarity: "rare",
                combat: { kind: "damageBonus", value: 0.1 },
            },
        } as HollowGateShrineRun,
        petAssisted: false,
    });
    const assisted = buildHollowGatePveEncounter({
        fight,
        character,
        run: {
            floor: 5,
            chosenAugment: {
                id: "berserkers-gamble",
                label: "Berserker's Gamble",
                description: "No retreat.",
                rarity: "rare",
                combat: { kind: "damageBonus", value: 0.1 },
            },
        } as HollowGateShrineRun,
        petAssisted: true,
    });
    assert.equal(assisted.ai.name, "Hollow Hound Alpha");
    assert.equal(assisted.petAssistName, undefined);
    assert.equal(assisted.ai.hp, plain.ai.hp);
    assert.equal(assisted.canWithdraw, false);
});

test("Hollow Gate combat helpers format verified rewards without restoring combat vitals", () => {
    assert.equal(
        formatHollowGateCombatReward({
            ok: true,
            won: true,
            reward: { ryo: 250, hollowShards: 2 },
            elementalShards: 1,
        }),
        "+250 ryo, +2 Hollow Shards, +1 Elemental Shard",
    );
});
